/**
 * ==============================================================================
 * FaWW Workspace - 지메일 출장/업무소통 자동 연동 시스템 (ChatGPT 연동 고도화 버전)
 * ==============================================================================
 * 
 * [동기화 문제 해결 체크리스트]
 * 1. OPENAI_API_KEY 에 실제 발급받은 OpenAI API 키를 입력하셔야 정상 작동합니다.
 * 2. 지메일에 "회사명/담당자명" 형태의 계층형 라벨(예: "1. 텔러스헬스/홍길동")이 적용되어 있어야 합니다.
 * 3. 메일은 "읽지 않음" 상태여야 하며, 별표(*)가 없어야 작동합니다.
 */

// ⚠️ 보안을 위해 Firebase DB Auth Secret 및 OpenAI API Key를 구글 앱스 스크립트 속성(Script Properties)에서 읽어오도록 설정합니다.
// 로컬 소스 코드나 Git 커밋에 API Key 및 Master DB Token이 노출되는 것을 완벽하게 방지합니다.
const FIREBASE_DB_SECRET = PropertiesService.getScriptProperties().getProperty('FIREBASE_AUTH_TOKEN') || PropertiesService.getScriptProperties().getProperty('FIREBASE_DB_SECRET') || "YOUR_FIREBASE_DB_SECRET_HERE";
const FIREBASE_DB_URL = `https://coworking-tool-default-rtdb.firebaseio.com/businessTrips.json?auth=${FIREBASE_DB_SECRET}`;
const COMMUNICATIONS_DB_URL = `https://coworking-tool-default-rtdb.firebaseio.com/businessCommunications.json?auth=${FIREBASE_DB_SECRET}`;
const EXTERNAL_EVENTS_DB_URL = `https://coworking-tool-default-rtdb.firebaseio.com/external_events.json?auth=${FIREBASE_DB_SECRET}`;
const LEAVES_DB_URL = `https://coworking-tool-default-rtdb.firebaseio.com/leaves.json?auth=${FIREBASE_DB_SECRET}`;
// 메일 처리 기록 (메일 ID 단위). 앱(클라이언트)은 접근하지 않으며, 보안 규칙에 없는 경로라 앱에서는 읽기·쓰기가 거부된다.
const GMAIL_STATE_DB_URL = `https://coworking-tool-default-rtdb.firebaseio.com/gmailSyncState.json?auth=${FIREBASE_DB_SECRET}`;
const REVIEW_LABEL_NAME = 'FaWW-검토필요';   // '/' 를 넣으면 출장 라벨로 오인되므로 넣지 않는다
const MAX_PARSE_ATTEMPTS = 3;                 // 같은 메일 분석·등록 실패 허용 횟수
const SEARCH_NEWER_THAN = '90d';              // 검색 기간
const MAX_THREADS_PER_RUN = 200;              // 한 번에 살펴볼 스레드 수 (50개씩 페이지)
const MAX_AI_CALLS_PER_RUN = 30;              // 한 번 실행에서 AI 분석할 메일 수 (실행 시간 6분 제한 대비, 남은 메일은 다음 실행)

const OPENAI_API_KEY = PropertiesService.getScriptProperties().getProperty('OPENAI_API_KEY') || "YOUR_OPENAI_API_KEY_HERE";


function autoRegisterTripsWithChatGPT() {
  Logger.log("=== FaWW Gmail ChatGPT Sync Started ===");

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    Logger.log("⚠️ 동기화 프로세스가 이미 실행 중입니다. 중복 방지를 위해 이번 실행은 안전하게 스킵합니다.");
    return;
  }

  try {
    if (!FIREBASE_DB_SECRET || FIREBASE_DB_SECRET === "YOUR_FIREBASE_DB_SECRET_HERE") {
    Logger.log("❌ 오류: Firebase DB Secret(또는 Auth Token)이 설정되지 않았습니다. 앱스 스크립트 속성(Script Properties)에 'FIREBASE_AUTH_TOKEN' 또는 'FIREBASE_DB_SECRET'을 등록해 주세요.");
    return;
  }

  if (OPENAI_API_KEY === "YOUR_OPENAI_API_KEY_HERE" || !OPENAI_API_KEY) {
    Logger.log("❌ 오류: OpenAI API Key가 설정되지 않았습니다. 앱스 스크립트 속성에 'OPENAI_API_KEY'를 등록해 주세요.");
    return;
  }

  // 1. 모든 지메일 사용자 라벨 조회
  const allLabels = GmailApp.getUserLabels();
  Logger.log(`지메일에 등록된 총 라벨 수: ${allLabels.length}개`);

  // 계층형 라벨만 필터링 (/ 가 포함된 라벨 - 기존 출장용 라벨)
  const targetLabels = allLabels.filter(l => l.getName().indexOf('/') !== -1);
  const targetLabelNames = targetLabels.map(l => `label:"${l.getName()}"`);

  if (targetLabelNames.length === 0) {
    Logger.log("⚠️ 동기화 대상 출장용 계층형 라벨이 지메일에 존재하지 않습니다. 동기화를 건너뜁니다.");
    return;
  }

  // 처리 기록 불러오기 (실패하면 중복 처리를 막기 위해 이번 실행은 중단)
  const syncState = loadGmailSyncState();
  if (!syncState) {
    Logger.log("❌ 메일 처리 기록을 불러오지 못해 이번 실행을 건너뜁니다 (중복 처리 방지).");
    return;
  }

  // 2. 검색 Query 구성: 대상 라벨 + 최근 기간. 처리 여부는 메일별 처리 기록으로 판단
  const searchQuery = `(${targetLabelNames.join(" OR ")}) newer_than:${SEARCH_NEWER_THAN}`;
  Logger.log(`생성된 지메일 검색 쿼리: ${searchQuery}`);

  // 최근 스레드를 50개씩 여러 페이지 검색 (최대 MAX_THREADS_PER_RUN)
  const threads = [];
  for (let start = 0; start < MAX_THREADS_PER_RUN; start += 50) {
    const page = GmailApp.search(searchQuery, start, 50);
    page.forEach(t => threads.push(t));
    if (page.length < 50) break;
  }
  Logger.log(`Found ${threads.length} potential threads to inspect.`);
  let aiCalls = 0;

  for (let i = 0; i < threads.length; i++) {
    if (aiCalls >= MAX_AI_CALLS_PER_RUN) {
      Logger.log(`⏸️ 이번 실행의 AI 분석 한도(${MAX_AI_CALLS_PER_RUN}건)에 도달했습니다. 남은 메일은 다음 실행에서 처리합니다.`);
      break;
    }
    const thread = threads[i];
    let mailCategory = "일반출장";
    let labelAssignee = "";

    // 메일의 라벨을 파싱하여 출장 카테고리(회사명)와 담당 직원명 동적 추출
    const labels = thread.getLabels();
    const tripLabel = labels.find(l => l.getName().indexOf('/') !== -1 && l.getName() !== REVIEW_LABEL_NAME);

    if (tripLabel) {
      const labelName = tripLabel.getName();
      const parts = labelName.split('/');
      // 상위 카테고리에서 숫자 및 불필요한 번호 접두사 제거 (예: "1. 텔러스헬스" -> "텔러스헬스", "3.한국중부발전" -> "한국중부발전")
      mailCategory = parts[0].replace(/^\d+[\.\s]*/, "").trim();
      if (parts.length > 1) labelAssignee = parts[1].trim();
    } else {
      // 출장용 계층형 라벨이 없는 경우 처리 대상이 아니므로 다음 스레드로 패스
      continue;
    }

    const messages = thread.getMessages();

    // 스레드 내의 개별 메일(메시지) 단위로 순회하며 동기화되지 않은 건만 처리
    for (let m = 0; m < messages.length; m++) {
      const msg = messages[m];

      // 이미 처리했거나(처리 기록) 검토 필요로 멈춘 메일은 건너뜀. 전환 이전 메일은 별표도 처리 완료로 인정.
      if (isGmailMessageProcessed(msg, syncState)) {
        continue;
      }
      if (aiCalls >= MAX_AI_CALLS_PER_RUN) break;
      aiCalls++;

      const subject = msg.getSubject();
      const threadId = thread.getId();
      
      let contextBody = "";
      for (let k = 0; k <= m; k++) {
        contextBody += `\n--- [메일 ${k + 1}] ---\n${messages[k].getPlainBody()}\n`;
      }
      
      const fullText = `[제목]: ${subject}\n[스레드 누적 본문]: ${contextBody}`;

      console.log(`🚀 [${mailCategory}/${labelAssignee}] 개별 메일 분석 중... [제목: ${subject}]`);

      let parsedData = parseEmailWithChatGPT(fullText);
      if (!parsedData) {
        markGmailMessageFailed(msg, thread, syncState, 'AI 분석 실패');
        continue;
      }

      if (parsedData) {
        // 1. 일반 업무 소통 메일인 경우 (출장이 아님)
        if (parsedData.is_trip === false) {
          console.log(`📧 일반 소통 메일 감지: ${subject}`);

          let communicationData = {
            title: subject,
            summary: parsedData.summary || "업무 소통 내용 요약이 없습니다.",
            category: parsedData.category || "일반문의",
            sender: parsedData.assignee || labelAssignee || "미상",
            timestamp: Date.now(),
            emailDate: msg.getDate().getTime(),
            categoryLabel: mailCategory
          };

          const response = UrlFetchApp.fetch(COMMUNICATIONS_DB_URL, {
            method: 'post',
            contentType: 'application/json',
            payload: JSON.stringify(communicationData),
            muteHttpExceptions: true
          });

          const responseCode = response.getResponseCode();
          const responseText = response.getContentText();
          console.log(`Communication Response Code: ${responseCode} | Content: ${responseText}`);

          if (responseCode === 200) {
            try {
              // Firebase가 자동 생성한 Key를 id 필드로 역맵핑(PATCH)하여 데이터 무결성 보장
              const resObj = JSON.parse(responseText);
              if (resObj && resObj.name) {
                const baseDbUrl = COMMUNICATIONS_DB_URL.split('.json')[0];
                const authParam = COMMUNICATIONS_DB_URL.split('?')[1] || "";
                const patchUrl = `${baseDbUrl}/${resObj.name}.json?${authParam}`;

                UrlFetchApp.fetch(patchUrl, {
                  method: 'patch',
                  contentType: 'application/json',
                  payload: JSON.stringify({ id: resObj.name }),
                  muteHttpExceptions: true
                });
              }
            } catch (err) {
              console.log(`⚠️ ID 필드 맵핑 패치 에러: ${err}`);
            }

            console.log(`✅ 일반 메일 요약 등록 완료: ${communicationData.summary}`);
            markGmailMessageDone(msg, syncState);
          } else {
            console.log(`❌ Firebase 전송 실패 (일반 소통): ${responseText}`);
            markGmailMessageFailed(msg, thread, syncState, 'Firebase 전송 실패 (일반 소통)');
          }
          continue;
        }

        // 2. 출장 메일인 경우
        let tripsToRegister = [];
        if (Array.isArray(parsedData.trips)) {
          tripsToRegister = parsedData.trips;
        } else if (parsedData.name) {
          tripsToRegister = [parsedData];
        }

        if (tripsToRegister.length === 0) {
          console.log("⚠️ 추출된 출장 정보가 없습니다.");
          markGmailMessageFailed(msg, thread, syncState, '출장 메일인데 날짜·장소를 추출하지 못함');
          continue;
        }

        // 실시간 중복 체크를 위해 기존 DB 출장 일정 가져오기
        const existingTrips = fetchExistingTrips();
        let successfullyRegistered = false;
        // 한 메일에서 추출된 여러 날짜는 각각 독립 일정: 같은 기존 일정을 두 날짜가 함께 덮어쓰지 않도록 추적
        const usedKeysInMessage = {};

        for (let j = 0; j < tripsToRegister.length; j++) {
          const trip = tripsToRegister[j];
          if (!trip.name) continue;

          const sDate = trip.startDate || null;
          const eDate = trip.endDate || sDate;

          // 시작일과 종료일이 다를 경우 "시작일 to 종료일" 포맷으로 자동 변환 (달력 렌더링 최적화)
          let dateVal = sDate || "";
          if (sDate && eDate && sDate !== eDate) {
            dateVal = `${sDate} to ${eDate}`;
          }

          let tripData = {
            name: trip.name,
            startDate: sDate,
            endDate: eDate,
            date: dateVal,
            assignee: trip.assignee || labelAssignee || "미정", // 실제 파싱된 개별 강사/담당자를 우선 적용
            contact: trip.contact || "",
            address: trip.address || "주소 미상",
            roomType: "single",
            bookedHotel: "",
            requiredGender: trip.requiredGender || "any",
            requiredPersonnel: parseInt(trip.requiredPersonnel) || 1,
            author: "Gmail 자동 등록",
            category: mailCategory,
            sourceThreadId: threadId,
            status: parsedData.status || "조율중",
            timestamp: Date.now()
          };

          const baseDbUrl = FIREBASE_DB_URL.split('.json')[0];
          const authParam = FIREBASE_DB_URL.split('?')[1] || "";

          // 같은 스레드의 기존 일정 중 '이 날짜'에 해당하는 일정만 매칭 (다른 날짜 일정은 별개 일정으로 유지)
          const threadCandidates = findAllDuplicateTripsByThreadId(tripData, threadId, existingTrips);
          const matchKeyByThread = pickThreadMatchForTrip(threadCandidates, tripData, parsedData, tripsToRegister.length, existingTrips, usedKeysInMessage);

          // [분기 1] 취소 메일인 경우
          if (parsedData.is_cancel === true) {
            console.log(`🚨 출장 취소 메일 감지. 삭제 시도: ${tripData.name} (${tripData.assignee})`);
            const matchKey = matchKeyByThread || findDuplicateTripForCancelOrUpdate(tripData, parsedData.originalStartDate, existingTrips, usedKeysInMessage);
            if (matchKey) {
              usedKeysInMessage[matchKey] = true;
              const deleteUrl = `${baseDbUrl}/${matchKey}.json?${authParam}`;
              const deleteResponse = UrlFetchApp.fetch(deleteUrl, {
                method: 'delete',
                muteHttpExceptions: true
              });
              if (deleteResponse.getResponseCode() === 200) {
                console.log(`✅ 기존 출장 일정 삭제 성공 (Key: ${matchKey})`);
                
                // [신규] 백엔드 기반 구글 캘린더 직통 삭제 로직 추가 (Option 2 대응)
                findAndModifyGoogleCalendarEvent(matchKey, 'delete', null);
                
                successfullyRegistered = true;
              } else {
                console.log(`❌ 기존 출장 일정 삭제 실패: ${deleteResponse.getContentText()}`);
              }
            } else {
              console.log(`⚠️ 취소할 기존 출장 일정을 찾지 못했습니다.`);
              successfullyRegistered = true; // 메일은 별표 처리하도록 넘김
            }
            continue;
          }

          // [분기 2] 수정/변경 메일이거나 동일 스레드 내의 답장인 경우
          if (parsedData.is_update === true || matchKeyByThread) {
            console.log(`🔄 출장 수정 메일 감지. 업데이트 시도: ${tripData.name} (${tripData.assignee})`);
            const matchKey = matchKeyByThread || findDuplicateTripForCancelOrUpdate(tripData, parsedData.originalStartDate, existingTrips, usedKeysInMessage);
            if (matchKey) {
              usedKeysInMessage[matchKey] = true;
              const patchUrl = `${baseDbUrl}/${matchKey}.json?${authParam}`;
              const updateData = {
                name: tripData.name,
                startDate: tripData.startDate,
                endDate: tripData.endDate,
                date: tripData.date,
                assignee: tripData.assignee,
                contact: tripData.contact || existingTrips[matchKey].contact || "",
                address: tripData.address,
                requiredPersonnel: tripData.requiredPersonnel,
                requiredGender: tripData.requiredGender,
                category: tripData.category,
                status: tripData.status,
                sourceThreadId: tripData.sourceThreadId || existingTrips[matchKey].sourceThreadId || ""
              };
              const patchResponse = UrlFetchApp.fetch(patchUrl, {
                method: 'patch',
                contentType: 'application/json',
                payload: JSON.stringify(updateData),
                muteHttpExceptions: true
              });
              if (patchResponse.getResponseCode() === 200) {
              console.log(`✅ 기존 출장 일정 수정 성공 (Key: ${matchKey})`);
              
              // [신규] 백엔드 기반 구글 캘린더 직통 수정 로직 추가 (Option 2 대응)
              findAndModifyGoogleCalendarEvent(matchKey, 'update', updateData);
              
              // (예전의 '확정 시 같은 스레드의 나머지 후보 일정 자동 삭제' 로직은 제거됨:
              //  한 메일의 여러 날짜는 각각 독립된 출장이므로, 하나가 확정돼도 다른 날짜는 지우지 않는다)

              successfullyRegistered = true;
            } else {
                console.log(`❌ 기존 출장 일정 수정 실패: ${patchResponse.getContentText()}`);
              }
              continue;
            } else {
              console.log(`⚠️ 수정할 기존 출장 일정을 찾지 못했습니다. 신규 등록으로 진행합니다.`);
            }
          }

          // [분기 3] 일반 신규 등록 또는 수작업 중복 체크
          const duplicateKey = findDuplicateTrip(tripData, existingTrips);
          if (duplicateKey) {
            console.log(`⚠️ 중복 일정 감지. 신규 등록을 스킵하고 기존 레코드를 보완합니다. (Key: ${duplicateKey})`);
            const patchUrl = `${baseDbUrl}/${duplicateKey}.json?${authParam}`;
            
            const newStatus = tripData.status || existingTrips[duplicateKey].status;
            
            const patchResponse = UrlFetchApp.fetch(patchUrl, {
              method: 'patch',
              contentType: 'application/json',
              payload: JSON.stringify({
                contact: tripData.contact || existingTrips[duplicateKey].contact || "",
                address: tripData.address || existingTrips[duplicateKey].address || "주소 미상",
                status: newStatus
              }),
              muteHttpExceptions: true
            });
            if (patchResponse.getResponseCode() === 200) {
              console.log(`✅ 중복 일정 보완 및 동기화 스킵 완료.`);
              
              if (newStatus) {
                const updateData = {
                  ...existingTrips[duplicateKey],
                  ...tripData,
                  status: newStatus
                };
                findAndModifyGoogleCalendarEvent(duplicateKey, 'update', updateData);
              }
              
              successfullyRegistered = true;
            }
          } else {
            // 완전 새 일정 등록
            const response = UrlFetchApp.fetch(FIREBASE_DB_URL, {
              method: 'post',
              contentType: 'application/json',
              payload: JSON.stringify(tripData),
              muteHttpExceptions: true
            });

            const responseCode = response.getResponseCode();
            const responseText = response.getContentText();
            console.log(`Response Code: ${responseCode} | Content: ${responseText}`);

            if (responseCode === 200) {
              try {
                const resObj = JSON.parse(responseText);
                if (resObj && resObj.name) {
                  const patchUrl = `${baseDbUrl}/${resObj.name}.json?${authParam}`;
                  UrlFetchApp.fetch(patchUrl, {
                    method: 'patch',
                    contentType: 'application/json',
                    payload: JSON.stringify({ id: resObj.name }),
                    muteHttpExceptions: true
                  });

                  // [신규] 백엔드 기반 구글 캘린더 직통 생성 (프론트엔드 다중 접속 중복 생성 버그 완벽 차단)
                  try {
                    // 대표님 요청 반영: '확정' 상태가 아니면 구글 캘린더를 지저분하게 만들지 않고 생략!
                    if (tripData.status === "확정") {
                      let targetCal = null;
                      const cals = CalendarApp.getCalendarsByName("FAWW");
                      if (cals && cals.length > 0) targetCal = cals[0];
                      else targetCal = CalendarApp.getDefaultCalendar();
  
                      if (targetCal) {
                        let descStr = `카테고리: ${tripData.category || '외부 연동'}\n담당자: ${tripData.assignee || '미지정'}\n연락처: ${tripData.contact || '없음'}\n주소: ${tripData.address || '없음'}\n[FaWW 출장연동 ID: ${resObj.name}]`;
                        if (tripData.sourceThreadId) {
                          descStr += `\n[Gmail Thread ID: ${tripData.sourceThreadId}]`;
                        }
  
                        const gStart = new Date(tripData.startDate || tripData.date.split(' to ')[0]);
                        let gEnd = new Date(tripData.endDate || tripData.date.split(' to ')[1] || tripData.startDate || tripData.date.split(' to ')[0]);
  
                        // 구글 캘린더 API 특성상 종일일정의 종료일은 +1일(Exclusive)이어야 함
                        gEnd.setDate(gEnd.getDate() + 1);
  
                        const statusPrefix = `[확정]`;
                        
                        // 🌟 중복 판정은 오직 고유 ID 태그([FaWW 출장연동 ID: resObj.name])로만 한다.
                        //    제목·장소가 비슷해도 ID 가 다르면 다른 일정이므로 절대 덮어쓰지 않고 새로 만든다.
                        //    (같은 메일을 재처리하는 등 동일 ID 일정이 이미 있을 때만 그 일정을 갱신)
                        const existingById = findCalendarEventByFawwId(targetCal, resObj.name);

                        if (existingById) {
                          console.log(`ℹ️ 동일 고유 ID 일정이 이미 있어 갱신합니다 (ID: ${resObj.name}): ${existingById.getTitle()}`);
                          existingById.setTitle(`${statusPrefix} ${tripData.name}`);
                          existingById.setDescription(descStr);
                          existingById.setLocation(tripData.address || '');
                          existingById.setAllDayDates(gStart, gEnd);
                        } else {
                          targetCal.createAllDayEvent(`${statusPrefix} ${tripData.name}`, gStart, gEnd, {
                            description: descStr,
                            location: tripData.address || ''
                          });
                          console.log(`✅ 구글 캘린더 백엔드 직통 생성 완료: ${statusPrefix} ${tripData.name} (ID: ${resObj.name})`);
                        }
                      }
                    } else {
                      console.log(`ℹ️ 상태가 '${tripData.status}'이므로 구글 캘린더 생성을 생략합니다. (대표님 수동 캘린더 관리 우선)`);
                    }
                  } catch (calErr) {
                    console.log(`⚠️ 구글 캘린더 백엔드 직통 생성/업데이트 실패: ${calErr.message}`);
                  }
                }
              } catch (err) {
                console.log(`⚠️ ID 필드 맵핑 패치 에러: ${err}`);
              }

              console.log(`✅ 등록 완료: ${tripData.name} (담당자: ${tripData.assignee} | 주소: ${tripData.address} | 날짜: ${tripData.date})`);
              successfullyRegistered = true;
            } else {
              console.log(`❌ Firebase 전송 실패 (출장): ${responseText}`);
            }
          }
        }

        if (successfullyRegistered) {
          markGmailMessageDone(msg, syncState);
        } else {
          markGmailMessageFailed(msg, thread, syncState, '출장 등록 실패');
        }
      }
    }
  }

  // 365일 무적 구글 캘린더 직통 동기화 자동 연결 호출
  try {
    syncGoogleCalendarDirectlyToFirebase();
    syncLeavesToGoogleCalendar();
  } catch (syncErr) {
    Logger.log("⚠️ 캘린더 직통 동기화 연쇄 호출 에러: " + syncErr.message);
  }

  } catch (globalError) {
    Logger.log("🔥 동기화 처리 중 전역 오류 발생: " + globalError);
  } finally {
    lock.releaseLock();
    Logger.log("🔒 동기화 락 해제 완료");
  }

  Logger.log("=== FaWW Gmail ChatGPT Sync Finished ===");
}


function parseEmailWithChatGPT(emailContent) {
  const url = "https://api.openai.com/v1/chat/completions";
  const todayStr = getTodayString();
  const currentYear = todayStr.split('-')[0];

  const payload = {
    "model": "gpt-4o-mini",
    "response_format": { "type": "json_object" },
    "messages": [
      {
        "role": "system",
        "content": `너는 이메일 본문을 분석하여 실제 현장 출장(Business Trip) 건인지, 일반 업무 소통/보고/서류 전달(Business Communication) 건인지를 명확히 판별하고 JSON으로 반환하는 엄격한 AI 분류 전문가야.
기준이 되는 오늘 날짜는 **${todayStr}** 이고, 현재 연도는 **${currentYear}년** 이다. 

🔥 [출장 vs 일반 소통 판별 및 분류 규칙 (Strict Rules)] 🔥
1. **'is_trip': true (실제 현장 출장 건)**
   - 담당자/강사가 **실제 특정 외부 기관, 지자체, 사업장, 고객사에 직접 현장 방문**하여 강의, 피지컬 상담, 점검, 현장 미팅을 수행하는 **구체적인 출장 일정**일 때만 true로 설정하고 trips 배열을 구성하라.
   - 반드시 "방문 목적지(장소명)"와 "구체적인 출장 수행 날짜"가 본문에 명시되어 있어야 한다.
   - **기존 출장 일정의 변경/수정 메일이나 취소 메일도 'is_trip': true 로 판별하고 trips를 파싱하라.**
   - [중요] 일정 조율을 위해 여러 가능한 날짜(후보)를 제안하는 "일정 조율 요청" 메일도 'is_trip': true 로 설정하되, 반드시 상태(status)를 "조율중"으로 분류하고 **제안된 모든 후보 날짜들을 각각 개별 trip 객체로 분리하여 파싱하라**. (예: 특정 본부에 후보 날짜가 3개 제안되었다면, 해당 본부의 trip 객체를 3개 만들어야 함)

2. **'is_trip': false (일반 업무 소통/보고/요청 건)** - ⚠️ 아래 케이스는 목적지나 기관명이 언급되더라도 무조건 is_trip: false로 설정하라!
   - 보고서/서류 첨부 송부, 결재/사인 요청 건 (예: 준공검사보고서 사인요청, 소개서 송부, 통장사본 첨부)
   - 강사 출입 신청서 작성 요청, 서류 양식 제출 요청, 신원확인 건
   - 단순히 운영 방식, 계약, 비용, 프로그램 확정/변경에 관한 질의응답 및 단순 공지/보고 건 (방문 일정이 수반되지 않는 건)
   - 실제 현장 출장을 떠나는 주체가 아닌, 이메일을 통한 서류 전달 및 소통 건

🔥 [1. 출장 메일인 경우 (is_trip: true) 최상위 필드 및 trips 추출 규칙] 🔥
- **최상위 JSON 스키마 필드**:
  * 'is_trip': true 로 설정.
  * 'is_update' (boolean): 메일 제목이나 본문에서 기존 일정을 **변경, 수정, 연기, 날짜 조정**한다는 내용이 있을 때 true.
  * 'is_cancel' (boolean): 메일 내용에서 기존 일정을 **취소, 철회, 제외, 회수**한다는 내용이 있을 때 true.
  * 'originalStartDate' (string, YYYY-MM-DD 또는 null): 일정 변경('is_update: true') 또는 취소('is_cancel: true') 시, 변경/취소되기 전 **원래의 출장 시작 날짜**. 메일에 기존 날짜 정보가 없다면 정황으로 추정하거나 알 수 없으면 null 로 지정.
  * 'status' (string): 현재 출장 일정의 확정 여부. 메일 맥락 상 날짜나 일정을 제안/조율/문의 중이거나 변경을 요청하는 단계면 "조율중"으로 설정하라. 반면 "좋습니다", "확인했습니다", "픽스하시죠", "진행하겠습니다" 등 확정 및 동의의 표현이 명확하면 "확정"으로 설정하라.

- **trips 배열 내의 개별 출장 객체 추출 (⚠️ 절대 누락 금지)**:
  * [중요] 메일 본문이나 표(Table)에 여러 개의 지사, 장소가 나열되어 있고 각 장소별로 후보 날짜가 여러 개 제안된 경우, **단 한 건도 누락하지 말고 반드시 "각 장소 x 각 후보 날짜" 조합마다 1개의 개별 trip 객체로 완벽히 분리하여 추출하라**. (예: 12개 장소에 각각 3개씩 후보 날짜가 적혀있다면 배열에 총 36개의 객체가 들어가야 함)
  * name: 출장 목적지 이름 또는 기관명 (예: "부산 기장군청 피지컬상담실 방문"). 본문에서 파악된 정보가 없으면 제목을 참고하라.
  * startDate: 출장 시작 날짜 (형식: YYYY-MM-DD). 이메일 본문에 연도 없이 월/일만 있는 경우(예: "6월 16일"), 기준 연도인 ${currentYear}년을 적용하여 "${currentYear}-06-16" 형식으로 채워라. 변경/수정 메일인 경우 **새로 변경된 날짜**를 여기에 채운다.
  * endDate: 출장 종료 날짜 (형식: YYYY-MM-DD). 단일일 출장이거나 종료일이 없으면 startDate와 동일하게 지정하라.
  * assignee: 출장 대상자 이름 (예: 강사명 또는 담당자명).
  * contact: 출장자 연락처. 없으면 빈 문자열("")로 반환하라.
  * address: 실제 출장 목적지 주소. 본문 하단 서명란에 있는 발신자 사무실 주소는 무시하라. 구체적인 주소가 없으면 제목의 지명(예: "부산 기장군청")을 주소로 반환하라.
  * requiredPersonnel: 출장 총 인원수 (숫자 형식, 기본값 1).
  * requiredGender: 필요한 성별 요구사항 ("any", "male", "female" 중 하나).

🔥 [2. 일반 업무 소통 메일인 경우 (is_trip: false) 추출 규칙] 🔥
- is_trip: false로 설정.
- summary: [중요] 이메일 본문과 제목을 읽고 본질적인 소통 내용을 명확하고 직관적인 **단 1문장의 한글**로 요약하라. 경어체(~건입니다, ~바랍니다 등)로 단정하게 끝마치라. (예: "준공검사보고서 작성이 완료되어 사인 및 확인 요청 건입니다.")
- category: 메일 성격에 맞춰 다음 4가지 대분류 중 하나를 정확히 매핑하라:
  * '업무보고' (보고서/서류 전달, 사인/결재 요청, 피드백 건)
  * '공지사항' (서비스 소개서, 전사 알림, 제도 개편, 공유 공지 건)
  * '일정공유' (회의 개설, 일정 조율, 교육 예약 건)
  * '일반문의' (단순 질문, 출입 서류 양식 요청 등 기타 건)
- assignee: 메일 본문이나 발신자명에서 추정된 담당 직원/발신자 이름 (예: "박지영").

[응답 형식 예시 1 - 신규 출장 메일인 경우]
{
  "is_trip": true,
  "is_update": false,
  "is_cancel": false,
  "originalStartDate": null,
  "status": "조율중",
  "trips": [
    {
      "name": "동대문구청 찾아가는 피지컬 상담실",
      "startDate": "${currentYear}-07-24",
      "endDate": "${currentYear}-07-24",
      "assignee": "김하람",
      "contact": "",
      "address": "동대문구청",
      "requiredPersonnel": 1,
      "requiredGender": "any"
    }
  ]
}

[응답 형식 예시 2 - 수정/변경 출장 메일인 경우]
{
  "is_trip": true,
  "is_update": true,
  "is_cancel": false,
  "originalStartDate": "${currentYear}-07-25",
  "status": "확정",
  "trips": [
    {
      "name": "동대문구청 찾아가는 피지컬 상담실",
      "startDate": "${currentYear}-07-28",
      "endDate": "${currentYear}-07-28",
      "assignee": "김하람",
      "contact": "",
      "address": "동대문구청",
      "requiredPersonnel": 1,
      "requiredGender": "any"
    }
  ]
}

[응답 형식 예시 3 - 일반 소통 메일인 경우]
{
  "is_trip": false,
  "summary": "준공검사보고서 작성이 완료되어 사인 및 확인 요청 건입니다.",
  "category": "업무보고",
  "assignee": "박지영"
}`
      },
      {
        "role": "user",
        "content": emailContent
      }
    ],
    "temperature": 0.2
  };

  const options = {
    "method": "post",
    "contentType": "application/json",
    "headers": { "Authorization": "Bearer " + OPENAI_API_KEY },
    "payload": JSON.stringify(payload),
    "muteHttpExceptions": true
  };

  try {
    const response = UrlFetchApp.fetch(url, options);
    const json = JSON.parse(response.getContentText());
    if (json.error) {
      Logger.log("❌ OpenAI API 에러 발생: " + json.error.message);
      return null;
    }
    if (json.choices && json.choices.length > 0) {
      let rawContent = json.choices[0].message.content.trim();
      // 마크다운 ```json 래퍼 정제
      rawContent = rawContent.replace(/^```json/gi, '').replace(/^```/g, '').replace(/```$/g, '').trim();
      return JSON.parse(rawContent);
    }
  } catch (e) {
    Logger.log("🔥 에러 발생: " + e);
  }
  return null;
}

function getTodayString() {
  return Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd");
}

/**
 * Firebase Realtime Database에서 전체 출장 목록을 로드하는 헬퍼 함수
 */
/**
 * 메일 처리 기록 (Firebase gmailSyncState)
 *  - messages/{메일ID} = { s: 'done' | 'failed' | 'review', n: 실패 횟수, t: 시각, r: 마지막 실패 사유 }
 *  - cutover: 이 방식으로 바뀐 시각. 그 이전 메일은 별표도 '처리 완료'로 인정한다 (예전 별표 방식과 호환).
 *  처리 완료 시에도 별표는 계속 달아 둔다 (화면 표시·이전 버전으로 되돌릴 때 호환). 다만 판단에는 쓰지 않는다.
 */
function loadGmailSyncState() {
  try {
    const res = UrlFetchApp.fetch(GMAIL_STATE_DB_URL, { method: 'get', muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return null;
    const state = JSON.parse(res.getContentText() || 'null') || {};
    if (!state.messages) state.messages = {};
    if (!state.cutover) {
      state.cutover = Date.now();
      const r = UrlFetchApp.fetch(GMAIL_STATE_DB_URL, { method: 'patch', contentType: 'application/json', payload: JSON.stringify({ cutover: state.cutover }), muteHttpExceptions: true });
      if (r.getResponseCode() !== 200) return null;
      Logger.log(`ℹ️ 메일 처리 기록 방식 시작 (이전 메일은 별표 기준으로 인정): ${new Date(state.cutover)}`);
    }
    return state;
  } catch (e) {
    Logger.log(`⚠️ 메일 처리 기록 조회 오류: ${e.message}`);
    return null;
  }
}

function isGmailMessageProcessed(msg, state) {
  const rec = state.messages[msg.getId()];
  if (rec && (rec.s === 'done' || rec.s === 'review')) return true;
  if (!rec && msg.getDate().getTime() < state.cutover && msg.isStarred()) return true; // 전환 이전 별표 메일
  return false;
}

function saveGmailMessageState(msgId, rec, state) {
  state.messages[msgId] = rec;
  const base = GMAIL_STATE_DB_URL.split('.json')[0];
  const auth = GMAIL_STATE_DB_URL.split('?')[1] || '';
  UrlFetchApp.fetch(`${base}/messages/${msgId}.json?${auth}`, { method: 'put', contentType: 'application/json', payload: JSON.stringify(rec), muteHttpExceptions: true });
}

function markGmailMessageDone(msg, state) {
  saveGmailMessageState(msg.getId(), { s: 'done', t: Date.now() }, state);
  try { msg.star(); } catch (e) { /* 표시용이므로 실패해도 무시 */ }
}

function markGmailMessageFailed(msg, thread, state, reason) {
  const prev = state.messages[msg.getId()] || {};
  const n = (prev.n || 0) + 1;
  if (n >= MAX_PARSE_ATTEMPTS) {
    saveGmailMessageState(msg.getId(), { s: 'review', n: n, t: Date.now(), r: reason }, state);
    try {
      const label = GmailApp.getUserLabelByName(REVIEW_LABEL_NAME) || GmailApp.createLabel(REVIEW_LABEL_NAME);
      thread.addLabel(label);
    } catch (e) { Logger.log(`⚠️ 검토 필요 라벨 부착 실패: ${e.message}`); }
    Logger.log(`🛑 ${n}회 실패하여 자동 처리를 멈추고 '${REVIEW_LABEL_NAME}' 라벨을 붙였습니다: [${msg.getSubject()}] 사유: ${reason}`);
  } else {
    saveGmailMessageState(msg.getId(), { s: 'failed', n: n, t: Date.now(), r: reason }, state);
    Logger.log(`⚠️ 처리 실패 ${n}/${MAX_PARSE_ATTEMPTS}회 (다음 실행에서 재시도): [${msg.getSubject()}] 사유: ${reason}`);
  }
}

function fetchExistingTrips() {
  try {
    const response = UrlFetchApp.fetch(FIREBASE_DB_URL, {
      method: "get",
      muteHttpExceptions: true
    });
    if (response.getResponseCode() === 200) {
      return JSON.parse(response.getContentText()) || {};
    }
  } catch (e) {
    console.log("⚠️ 기존 출장 목록 로드 에러: " + e);
  }
  return {};
}

/**
 * 신규 등록 시 중복 여부를 감지하는 헬퍼 함수 (개선된 스마트 감지)
 */
function findDuplicateTrip(newTrip, existingTrips) {
  if (!existingTrips) return null;
  const keys = Object.keys(existingTrips);
  const cleanStr = (str) => (str || '').replace(/\s+/g, '').toLowerCase();

  const newName = cleanStr(newTrip.name);
  const newAssignee = cleanStr(newTrip.assignee);
  const newDate = newTrip.startDate || newTrip.date || '';
  const newAddr = cleanStr(newTrip.address);

  // 단어 단위 비교를 위한 배열 (2글자 이상 단어만 추출)
  const extractWords = (str) => (str || '').split(/\s+/).filter(w => w.length >= 2).map(w => w.toLowerCase());
  const newNameWords = extractWords(newTrip.name);

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const ext = existingTrips[key];
    if (!ext) continue;

    const extName = cleanStr(ext.name);
    const extAssignee = cleanStr(ext.assignee);
    const extDate = ext.startDate || ext.date || '';
    const extAddr = cleanStr(ext.address);

    // 1. 날짜가 동일한가?
    const dateMatch = (extDate === newDate) || (ext.startDate && newTrip.startDate && ext.startDate === newTrip.startDate);
    if (!dateMatch) continue;

    // 2. 담당자가 동일한가? (또는 둘 다 동일 소속)
    const assigneeMatch = (extAssignee === newAssignee) || (extAssignee.includes(newAssignee) || newAssignee.includes(extAssignee));
    if (!assigneeMatch) continue;

    // 3. 목적지 행사명이나 주소가 동일/유사한가?
    let nameMatch = (extName === newName) || (extName.indexOf(newName) !== -1 || newName.indexOf(extName) !== -1);
    
    // 3-1. 스마트 단어 포함 감지 (예: "대법원 피지컬 케어" vs "대법원 형사재판부 피지컬 케어")
    if (!nameMatch) {
      const extNameWords = extractWords(ext.name);
      let commonWordsCount = 0;
      newNameWords.forEach(nw => {
        if (extNameWords.some(ew => ew.includes(nw) || nw.includes(ew))) {
          commonWordsCount++;
        }
      });
      // 핵심 단어가 2개 이상 겹치거나, 이름이 짧아 1개만 추출되었는데 완벽히 겹치면 동일 일정으로 간주
      if (commonWordsCount >= 2 || (newNameWords.length === 1 && commonWordsCount === 1)) {
        nameMatch = true;
      }
    }

    // 3-2. 주소 매칭 로직 ("주소미상" 끼리 묶이는 버그 방지)
    const isValidAddr = (addr) => addr && addr !== "주소미상";
    const addrMatch = isValidAddr(newAddr) && isValidAddr(extAddr) && 
                      (extAddr.indexOf(newAddr) !== -1 || newAddr.indexOf(extAddr) !== -1);

    if (nameMatch || addrMatch) {
      return key; // 중복 레코드 Key 반환!
    }
  }
  return null;
}

/**
 * [신규] 스레드 ID 기반으로 매칭되는 모든 일정(다중 후보 날짜 포함)을 찾는 헬퍼 함수
 */
/**
 * 같은 스레드의 후보 일정(threadCandidates) 중 이번 출장(tripData)에 해당하는 기존 일정 1건을 고른다.
 *  1) 시작 날짜가 같은 일정 → 같은 일정 (상태·세부 정보 갱신)
 *  2) 날짜 변경 메일(originalStartDate)이고 이번 메일의 출장이 1건일 때 → 원래 날짜의 일정
 *  3) 이번 메일의 출장이 1건이고 스레드 후보도 1건뿐일 때 → 그 일정 (단일 일정 스레드의 날짜 조정 답장)
 *  그 외(여러 날짜 메일에서 날짜가 다른 경우)에는 매칭하지 않는다 → 다른 날짜 일정을 덮어쓰지 않음.
 *  같은 메일에서 이미 매칭된 일정(usedKeys)은 다시 고르지 않는다.
 */
function pickThreadMatchForTrip(threadCandidates, tripData, parsedData, tripCountInMessage, existingTrips, usedKeys) {
  const candidates = threadCandidates || [];
  const free = candidates.filter(k => !(usedKeys && usedKeys[k]));
  if (free.length === 0) return null;
  const startOf = (k) => {
    const t = existingTrips[k] || {};
    return t.startDate || String(t.date || '').split(' to ')[0];
  };
  const sameDate = free.filter(k => startOf(k) === tripData.startDate);
  if (sameDate.length > 0) return sameDate[0];
  if (tripCountInMessage === 1 && parsedData && parsedData.originalStartDate) {
    const orig = free.filter(k => startOf(k) === parsedData.originalStartDate);
    if (orig.length > 0) return orig[0];
  }
  if (tripCountInMessage === 1 && candidates.length === 1 && free.length === 1) return free[0];
  return null;
}

function findAllDuplicateTripsByThreadId(tripData, threadId, existingTrips) {
  if (!existingTrips || !threadId) return [];
  const keys = Object.keys(existingTrips);
  const cleanStr = (str) => (str || '').replace(/\s+/g, '').toLowerCase();
  
  const matchedKeys = [];

  for (let i = 0; i < keys.length; i++) {
    const ext = existingTrips[keys[i]];
    if (ext.sourceThreadId === threadId) {
      // 스레드 아이디가 같더라도 장소/이름이 어느정도 일치해야 같은 건으로 취급 (한 스레드에 여러 출장지가 있을 수 있으므로)
      const nameMatch = ext.name && tripData.name && (cleanStr(ext.name).includes(cleanStr(tripData.name)) || cleanStr(tripData.name).includes(cleanStr(ext.name)));
      const addrMatch = ext.address && tripData.address && ext.address !== "주소 미상" && (ext.address.includes(tripData.address) || tripData.address.includes(ext.address));
      
      if (nameMatch || addrMatch) {
        matchedKeys.push(keys[i]);
      }
    }
  }
  return matchedKeys;
}

/**
 * 수정/취소 건 처리를 위해 기존 등록된 일정 목록 중에서 매칭 대상을 탐색하는 헬퍼 함수
 */
function findDuplicateTripForCancelOrUpdate(newTrip, originalStartDate, existingTrips, usedKeys) {
  const keys = Object.keys(existingTrips);
  const cleanStr = (str) => (str || '').replace(/\s+/g, '').toLowerCase();

  const targetDate = originalStartDate || newTrip.startDate;

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const ext = existingTrips[key];

    // 담당자가 같은지 확인
    const assigneeMatch = ext.assignee && newTrip.assignee &&
      (cleanStr(ext.assignee) === cleanStr(newTrip.assignee));

    if (!assigneeMatch) continue;

    // 날짜 조건이 맞는지 확인
    const dateMatch = (ext.startDate === targetDate) || (ext.date === targetDate);
    if (!dateMatch) continue;

    // 목적지 이름이 매치되는지 확인
    const extName = cleanStr(ext.name);
    const newName = cleanStr(newTrip.name);
    const nameMatch = extName.indexOf(newName) !== -1 || newName.indexOf(extName) !== -1;

    if (nameMatch) {
      return key;
    }
  }

  // 날짜가 정확히 떨어지지 않는 경우에 대비한 2차 탐색(날짜 조건 없음, 담당자+목적지).
  // 같은 이름의 출장이 여러 날짜에 있으면 어느 것인지 알 수 없으므로, 후보가 정확히 1건일 때만 사용한다.
  const looseMatches = [];
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const ext = existingTrips[key];
    if (usedKeys && usedKeys[key]) continue;

    const assigneeMatch = ext.assignee && newTrip.assignee &&
      (cleanStr(ext.assignee) === cleanStr(newTrip.assignee));

    if (!assigneeMatch) continue;

    const extName = cleanStr(ext.name);
    const newName = cleanStr(newTrip.name);
    if (extName === newName || extName.indexOf(newName) !== -1 || newName.indexOf(extName) !== -1) {
      looseMatches.push(key);
    }
  }
  if (looseMatches.length === 1) return looseMatches[0];
  if (looseMatches.length > 1) {
    console.log(`⚠️ 날짜가 다른 같은 이름의 출장이 ${looseMatches.length}건이라 대상을 특정할 수 없어 건드리지 않습니다: ${newTrip.name}`);
  }
  return null;
}

/**
 * [신규] 구글 캘린더 일정을 검색하여 취소(삭제) 또는 수정(업데이트)하는 헬퍼 함수
 * Firebase DB(businessTrips)가 아닌, 실제 구글 캘린더 연동(Option 2)의 삭제/수정을 담당합니다.
 */
/**
 * [캘린더 → 출장 DB] 구글 캘린더를 기준으로 확정 출장을 맞춘다. (단방향: 캘린더의 변경을 앱에 반영)
 *  - 캘린더 일정 설명의 [FaWW 출장연동 ID: key] 로 출장 DB(businessTrips/key)와 연결한다.
 *  - 연결된 일정이 있으면: 날짜·출장명·장소를 캘린더 값으로 맞추고, calendarLinked=true 표시를 남긴다.
 *    (숙소·차량·인원 등 앱에서만 관리하는 정보는 건드리지 않음)
 *  - calendarLinked 표시가 있는 확정 출장인데 캘린더에서 사라졌으면: 출장 DB에서도 삭제한다.
 *  안전장치
 *  - 조율중 등 '확정'이 아닌 출장, 캘린더에 연결된 적이 확인되지 않은 출장(앱에서 직접 만든 출장 등)은 삭제하지 않는다.
 *  - 날짜를 멀리 옮긴 일정을 삭제로 오인하지 않도록 ID 는 넓은 기간(과거 6개월~미래 12개월)에서 찾는다.
 *  - 삭제는 출장 날짜가 동기화 기간(syncStart~syncEnd) 안에 있을 때만 한다.
 *  - 출장 DB 조회 실패 시 아무것도 하지 않는다. 한 번에 지울 건수가 비정상적으로 많으면 삭제를 건너뛴다.
 */
function syncCalendarChangesToTrips(targetCal, syncStart, syncEnd) {
  try {
    const tz = Session.getScriptTimeZone();
    const fmt = (d) => Utilities.formatDate(d, tz, "yyyy-MM-dd");
    const now = new Date();
    const wideFrom = new Date(now.getFullYear(), now.getMonth() - 6, 1);
    const wideTo = new Date(now.getFullYear(), now.getMonth() + 13, 0);

    // 1) 캘린더에서 ID 태그가 있는 일정 수집 (같은 ID 가 여러 건이면 첫 건 기준)
    const calById = {};
    const wideEvents = targetCal.getEvents(wideFrom, wideTo);
    wideEvents.forEach(evt => {
      const m = (evt.getDescription() || '').match(/\[FaWW 출장연동 ID:\s*([^\]\s]+)\]/);
      if (!m || calById[m[1]]) return;
      const startObj = evt.getStartTime();
      let endObj = evt.getEndTime();
      if (evt.isAllDayEvent()) {
        const adj = new Date(endObj.getTime() - 24 * 60 * 60 * 1000);
        endObj = adj >= startObj ? adj : startObj;
      }
      const name = String(evt.getTitle() || '').replace(/^(\s*\[(확정|조율중|출장|취소)\]\s*)+/, '').trim();
      calById[m[1]] = { startDate: fmt(startObj), endDate: fmt(endObj), name: name, location: evt.getLocation() || '' };
    });

    // 2) 출장 DB 조회 (실패 시 중단)
    const res = UrlFetchApp.fetch(FIREBASE_DB_URL, { method: 'get', muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) {
      Logger.log(`❌ 출장 DB 조회 실패로 캘린더 → 출장 반영을 건너뜁니다: ${res.getContentText()}`);
      return;
    }
    const trips = JSON.parse(res.getContentText() || 'null') || {};
    const syncStartStr = fmt(syncStart), syncEndStr = fmt(syncEnd);

    const updates = {};
    const deleteKeys = [];
    let changed = 0, linked = 0;
    Object.keys(trips).forEach(key => {
      const t = trips[key];
      if (!t || typeof t !== 'object' || t.status !== '확정') return;
      const cal = calById[key];
      if (cal) {
        const newDate = cal.startDate !== cal.endDate ? `${cal.startDate} to ${cal.endDate}` : cal.startDate;
        let diff = false;
        if (t.startDate !== cal.startDate) { updates[`${key}/startDate`] = cal.startDate; diff = true; }
        if ((t.endDate || t.startDate) !== cal.endDate) { updates[`${key}/endDate`] = cal.endDate; diff = true; }
        if (t.date !== newDate) { updates[`${key}/date`] = newDate; diff = true; }
        if (cal.name && t.name !== cal.name) { updates[`${key}/name`] = cal.name; diff = true; }
        if (cal.location && t.address !== cal.location) { updates[`${key}/address`] = cal.location; diff = true; }
        if (t.calendarLinked !== true) { updates[`${key}/calendarLinked`] = true; linked++; }
        if (diff) { changed++; Logger.log(`🔁 캘린더 변경을 출장에 반영: ${t.name} → ${cal.name} (${newDate})`); }
        return;
      }
      // 캘린더에 연결된 적이 있는 확정 출장만 삭제 후보
      if (t.calendarLinked !== true) return;
      const s = String(t.startDate || String(t.date || '').split(' to ')[0] || '');
      const e = String(t.endDate || s);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return;
      if (s <= syncEndStr && e >= syncStartStr) deleteKeys.push(key);
    });

    // 3) 대량 삭제 방지: 일시 오류로 캘린더가 비어 보이는 경우 등을 막는다.
    //    - 한 번에 10건 초과, 또는 5건 이상이면서 연결된 확정 출장의 절반 이상, 또는 캘린더 일정이 하나도 안 보이는 경우
    const linkedTotal = Object.keys(trips).filter(k => trips[k] && trips[k].status === '확정' && trips[k].calendarLinked === true).length;
    const looksBroken = deleteKeys.length > 10
      || (deleteKeys.length >= 5 && deleteKeys.length * 2 >= linkedTotal)
      || (deleteKeys.length > 0 && wideEvents.length === 0);
    if (looksBroken) {
      Logger.log(`🛑 캘린더에서 사라진 확정 출장이 ${deleteKeys.length}건(연결 ${linkedTotal}건 중)이라 비정상으로 판단, 출장 DB 삭제를 건너뜁니다. 캘린더를 확인해 주세요.`);
    } else {
      deleteKeys.forEach(k => { updates[k] = null; Logger.log(`🗑️ 캘린더에서 삭제된 확정 출장을 출장 DB에서도 삭제: ${trips[k].name} (${trips[k].date})`); });
    }

    if (Object.keys(updates).length === 0) return;
    const patchRes = UrlFetchApp.fetch(FIREBASE_DB_URL, {
      method: 'patch', contentType: 'application/json', payload: JSON.stringify(updates), muteHttpExceptions: true
    });
    if (patchRes.getResponseCode() === 200) {
      Logger.log(`✅ 캘린더 → 출장 반영 완료: 변경 ${changed}건 / 연결 표시 ${linked}건 / 삭제 ${Object.keys(updates).filter(k => updates[k] === null).length}건`);
    } else {
      Logger.log(`❌ 캘린더 → 출장 반영 실패: ${patchRes.getContentText()}`);
    }
  } catch (e) {
    Logger.log(`🔥 캘린더 → 출장 반영 중 오류: ${e.message}`);
  }
}

/**
 * 구글 캘린더에서 Description 에 "[FaWW 출장연동 ID: id]" 태그가 정확히 들어 있는 일정 1건을 찾는다.
 * - 닫는 대괄호까지 포함해 비교하므로 ID 가 다른 일정(접두어만 같은 경우 포함)은 절대 매칭되지 않는다.
 * - 날짜가 바뀌었을 수 있으므로 넓은 기간(과거 6개월 ~ 미래 12개월)을 검색한다.
 * - 같은 ID 가 여러 건이면(과거 중복 생성분) 첫 건을 돌려주고 로그를 남긴다.
 */
function findCalendarEventByFawwId(targetCal, fawwId) {
  if (!targetCal || !fawwId) return null;
  const tag = `[FaWW 출장연동 ID: ${fawwId}]`;
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth() - 6, 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 13, 0);
  const matches = targetCal.getEvents(from, to).filter(evt => {
    const desc = evt.getDescription() || '';
    return desc.indexOf(tag) !== -1;
  });
  if (matches.length > 1) {
    console.log(`⚠️ 같은 고유 ID 를 가진 구글 캘린더 일정이 ${matches.length}건 있습니다 (ID: ${fawwId}). 첫 건만 처리합니다.`);
  }
  return matches.length > 0 ? matches[0] : null;
}

function findAndModifyGoogleCalendarEvent(matchKey, action, updateData) {
  try {
    let targetCal = null;
    const cals = CalendarApp.getCalendarsByName("FAWW");
    if (cals && cals.length > 0) targetCal = cals[0];
    else targetCal = CalendarApp.getDefaultCalendar();

    if (!targetCal) return false;

    // 오직 Description 의 "[FaWW 출장연동 ID: matchKey]" 태그가 정확히 일치하는 일정만 수정/삭제한다.
    // (예전의 제목·담당자 교차검증 백업 탐색은 다른 일정을 잘못 건드릴 수 있어 제거)
    if (!matchKey) {
      console.log('⚠️ 고유 ID(matchKey)가 없어 구글 캘린더 수정/삭제를 건너뜁니다.');
      return false;
    }
    const targetEvent = findCalendarEventByFawwId(targetCal, matchKey);

    if (targetEvent) {
      if (action === 'delete') {
        targetEvent.deleteEvent();
        console.log(`✅ [캘린더 연동] 구글 캘린더 원본 일정 삭제 완료: ${targetEvent.getTitle()}`);
      } else if (action === 'update' && updateData) {
        // 타이틀 갱신 (상태 반영, 기존 메모 보존)
        const statusPrefix = updateData.status ? `[${updateData.status}]` : `[출장]`;
        let originalTitle = targetEvent.getTitle();
        originalTitle = originalTitle.replace(/^\[조율중\]\s*/i, '').replace(/^\[확정\]\s*/i, '').replace(/^\[출장\]\s*/i, '').replace(/^\[취소\]\s*/i, '');
        
        // 기존 제목에 새 이름이 아예 포함 안 되어 있다면 새 이름을 덧붙임
        if (!originalTitle.includes(updateData.name)) {
          targetEvent.setTitle(`${statusPrefix} ${updateData.name} ${originalTitle}`);
        } else {
          targetEvent.setTitle(`${statusPrefix} ${originalTitle}`);
        }
        targetEvent.setLocation(updateData.address || "");
        
        let descStr = `카테고리: ${updateData.category || '외부 연동'}\n담당자: ${updateData.assignee || '미지정'}\n연락처: ${updateData.contact || '없음'}\n주소: ${updateData.address || '없음'}\n[FaWW 출장연동 ID: ${matchKey}]`;
        if (updateData.sourceThreadId) {
          descStr += `\n[Gmail Thread ID: ${updateData.sourceThreadId}]`;
        }
        targetEvent.setDescription(descStr);

        // 날짜 업데이트 (종일 일정 기준으로 처리)
        if (updateData.startDate || updateData.date) {
          const sDateStr = updateData.startDate || updateData.date.split(' to ')[0];
          const eDateStr = updateData.endDate || updateData.date.split(' to ')[1] || sDateStr;
          
          const gStart = new Date(sDateStr);
          let gEnd = new Date(eDateStr);
          gEnd.setDate(gEnd.getDate() + 1); // 구글 캘린더 종일일정의 끝은 Exclusive(+1) 처리
          
          targetEvent.setAllDayDates(gStart, gEnd);
        }
        console.log(`✅ [캘린더 연동] 구글 캘린더 원본 일정 수정 완료: ${targetEvent.getTitle()}`);
      }
      return true;
    } else {
      // '조율중'일 때는 캘린더에 올리지 않으므로, '확정'으로 바뀐 일정은 이 시점에 새로 만든다 (모든 확정 날짜가 캘린더에 남도록)
      if (action === 'update' && updateData && updateData.status === '확정' && (updateData.startDate || updateData.date)) {
        const sDateStr = updateData.startDate || String(updateData.date).split(' to ')[0];
        const eDateStr = updateData.endDate || String(updateData.date || '').split(' to ')[1] || sDateStr;
        const gStart = new Date(sDateStr);
        const gEnd = new Date(eDateStr);
        gEnd.setDate(gEnd.getDate() + 1); // 종일 일정 종료일은 Exclusive(+1)
        let descStr = `카테고리: ${updateData.category || '외부 연동'}\n담당자: ${updateData.assignee || '미지정'}\n연락처: ${updateData.contact || '없음'}\n주소: ${updateData.address || '없음'}\n[FaWW 출장연동 ID: ${matchKey}]`;
        if (updateData.sourceThreadId) descStr += `\n[Gmail Thread ID: ${updateData.sourceThreadId}]`;
        targetCal.createAllDayEvent(`[확정] ${updateData.name}`, gStart, gEnd, { description: descStr, location: updateData.address || '' });
        console.log(`✅ [캘린더 연동] 확정된 일정이 캘린더에 없어 새로 생성: [확정] ${updateData.name} (ID: ${matchKey})`);
        return true;
      }
      console.log(`⚠️ 고유 ID 태그가 일치하는 구글 캘린더 일정이 없어 아무것도 수정/삭제하지 않았습니다. (Key: ${matchKey}) — ID 태그가 없는 예전·수동 일정은 직접 정리해 주세요.`);
      return false;
    }
  } catch (e) {
    console.log(`🔥 구글 캘린더 연동 수정/취소 중 에러: ${e.message}`);
    return false;
  }
}

/**
 * ==============================================================================
 * [하드코딩 24시간 365일 무적 동기화] Apps Script ➔ Firebase DB 직통 연동 함수
 * ==============================================================================
 * 대표 계정(contact@faww.co.kr)의 구글 캘린더/지메일 일정을 백엔드 권한으로 
 * Firebase Realtime DB (external_events)에 직접 써넣습니다.
 * 브라우저 토큰 만료와 관계없이 24시간 365일 100% 무조건 연동이 유지됩니다.
 */
function syncGoogleCalendarDirectlyToFirebase() {
  Logger.log("=== 🔄 Apps Script -> Firebase DB 365일 무적 직통 동기화 시작 ===");

  if (!FIREBASE_DB_SECRET || FIREBASE_DB_SECRET === "YOUR_FIREBASE_DB_SECRET_HERE") {
    Logger.log("❌ Firebase DB Secret이 설정되지 않아 직통 동기화를 건너뜁니다.");
    return;
  }

  try {
    const now = new Date();
    // 과거 3달전부터 미래 6달후까지 일정 수집
    const startDate = new Date(now.getFullYear(), now.getMonth() - 3, 1);
    const endDate = new Date(now.getFullYear(), now.getMonth() + 7, 0);

    // 1. 구글 캘린더에서 'FAWW' 캘린더 또는 기본 캘린더 가져오기
    let targetCalendar = null;
    const calendars = CalendarApp.getCalendarsByName("FAWW");
    if (calendars && calendars.length > 0) {
      targetCalendar = calendars[0];
    } else {
      targetCalendar = CalendarApp.getDefaultCalendar();
    }

    if (!targetCalendar) {
      Logger.log("⚠️ 캘린더를 찾을 수 없습니다.");
      return;
    }

    const events = targetCalendar.getEvents(startDate, endDate);
    Logger.log(`총 ${events.length}개의 구글 캘린더 일정을 가져왔습니다.`);

    // 캘린더(기준) → 출장 DB 반영: 확정 출장의 날짜·제목·장소 변경과 삭제를 출장 DB에도 맞춘다.
    // 기본 캘린더로 대체된 경우(FAWW 캘린더를 못 찾음)에는 잘못된 삭제를 막기 위해 실행하지 않는다.
    if (calendars && calendars.length > 0) {
      syncCalendarChangesToTrips(targetCalendar, startDate, endDate);
    } else {
      Logger.log("⚠️ 'FAWW' 캘린더를 찾지 못해 출장 DB 반영(수정·삭제)을 건너뜁니다.");
    }

    const externalEventsMap = {};

    events.forEach(event => {
      const eventId = event.getId().replace(/[^a-zA-Z0-9_-]/g, "_");
      const startObj = event.getStartTime();
      const endObj = event.getEndTime();

      const sDateStr = Utilities.formatDate(startObj, Session.getScriptTimeZone(), "yyyy-MM-dd");
      let eDateStr = Utilities.formatDate(endObj, Session.getScriptTimeZone(), "yyyy-MM-dd");

      // 종일 일정일 경우 하루 보정
      if (event.isAllDayEvent()) {
        const adjustedEnd = new Date(endObj.getTime() - (24 * 60 * 60 * 1000));
        if (adjustedEnd >= startObj) {
          eDateStr = Utilities.formatDate(adjustedEnd, Session.getScriptTimeZone(), "yyyy-MM-dd");
        }
      }

      let timePrefix = "";
      if (!event.isAllDayEvent()) {
        const timeStr = Utilities.formatDate(startObj, Session.getScriptTimeZone(), "HH:mm");
        timePrefix = ` [${timeStr}]`;
      }

      let extractedCategory = "외부 연동";
      let descStr = event.getDescription() || "";
      if (typeof descStr === 'string' && descStr.match(/<[^>]+>/)) {
        descStr = descStr.replace(/<br\s*[\/]?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, '').replace(/\n\s*\n/g, '\n').trim();
      }
      const catMatch = descStr.match(/카테고리:\s*([^\n]+)/);
      if (catMatch && catMatch[1]) {
        extractedCategory = catMatch[1].trim();
      }

      externalEventsMap[eventId] = {
        id: eventId,
        title: `${timePrefix} ${event.getTitle() || "(제목 없음)"}`.trim(),
        description: descStr,
        location: event.getLocation() || "",
        startDate: sDateStr,
        dueDate: eDateStr,
        isExternal: true,
        status: "todo",
        priority: "low",
        assignee: "FAWW 자동 연동",
        category: extractedCategory,
        colorId: event.getColor() || ""
      };
    });

    // 2. 현재 DB 의 external_events 를 먼저 읽는다. 읽기에 실패하면 아무것도 쓰지 않는다 (불완전 저장 방지).
    const getResponse = UrlFetchApp.fetch(EXTERNAL_EVENTS_DB_URL, { method: 'get', muteHttpExceptions: true });
    if (getResponse.getResponseCode() !== 200) {
      Logger.log(`❌ external_events 조회 실패로 동기화를 중단합니다 (DB 는 변경하지 않음): ${getResponse.getContentText()}`);
      return;
    }
    const existing = JSON.parse(getResponse.getContentText() || 'null') || {};

    // 3. PUT(전체 덮어쓰기) 대신 PATCH(다중 경로 부분 갱신)
    //  - 이미 있는 일정: 구글이 관리하는 필드만 갱신 → 앱에서 바꾼 담당자·진행 상태·우선순위는 보존
    //  - 새 일정: 기본값과 함께 추가
    //  - 동기화 기간 안에 있었는데 구글 캘린더에서 사라진 일정: null 로 삭제 (예전 PUT 의 삭제 동기화 역할 유지)
    //  - 동기화 기간 밖의 기록: 건드리지 않음 (예전 PUT 은 기간 밖 기록까지 모두 지웠음)
    const GOOGLE_FIELDS = ['id', 'title', 'description', 'location', 'startDate', 'dueDate', 'isExternal', 'category', 'colorId'];
    const windowStartStr = Utilities.formatDate(startDate, Session.getScriptTimeZone(), "yyyy-MM-dd");
    const windowEndStr = Utilities.formatDate(endDate, Session.getScriptTimeZone(), "yyyy-MM-dd");
    const updates = {};
    let added = 0, updated = 0, removed = 0;

    Object.keys(externalEventsMap).forEach(key => {
      const fresh = externalEventsMap[key];
      const cur = existing[key];
      if (cur && typeof cur === 'object') {
        GOOGLE_FIELDS.forEach(f => { updates[`${key}/${f}`] = fresh[f]; });
        updated++;
      } else {
        updates[key] = fresh;
        added++;
      }
    });

    Object.keys(existing).forEach(key => {
      if (externalEventsMap[key]) return;
      const rec = existing[key];
      if (!rec || typeof rec !== 'object') return;
      const s = String(rec.startDate || rec.dueDate || '');
      const e = String(rec.dueDate || rec.startDate || '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !/^\d{4}-\d{2}-\d{2}$/.test(e)) return; // 날짜를 알 수 없는 기록은 보존
      const overlapsWindow = s <= windowEndStr && e >= windowStartStr;
      if (overlapsWindow) { updates[key] = null; removed++; }
    });

    if (Object.keys(updates).length === 0) {
      Logger.log('ℹ️ external_events 변경 사항 없음');
      return;
    }

    const patchResponse = UrlFetchApp.fetch(EXTERNAL_EVENTS_DB_URL, {
      method: 'patch',
      contentType: 'application/json',
      payload: JSON.stringify(updates),
      muteHttpExceptions: true
    });

    if (patchResponse.getResponseCode() === 200) {
      Logger.log(`✅ external_events PATCH 완료: 추가 ${added}건 / 갱신 ${updated}건 / 기간 내 삭제 ${removed}건 (기간: ${windowStartStr} ~ ${windowEndStr})`);
    } else {
      Logger.log(`❌ Firebase DB 직통 저장 실패: ${patchResponse.getContentText()}`);
    }

  } catch (error) {
    Logger.log(`🔥 365일 무적 직통 동기화 오류: ${error.message}`);
  }

  Logger.log("=== 🔄 Apps Script -> Firebase DB 365일 무적 직통 동기화 종료 ===");
}

/**
 * ==============================================================================
 * [신규] FaWW 휴가 데이터 ➔ 구글 캘린더 동기화 함수
 * ==============================================================================
 * Firebase DB의 'leaves' 데이터를 구글 캘린더 'FAWW'에 동기화합니다.
 */
function syncLeavesToGoogleCalendar() {
  Logger.log("=== 🔄 FaWW 휴가 -> 구글 캘린더 동기화 시작 ===");
  if (!FIREBASE_DB_SECRET || FIREBASE_DB_SECRET === "YOUR_FIREBASE_DB_SECRET_HERE") {
    Logger.log("❌ Firebase DB Secret이 설정되지 않아 휴가 동기화를 건너뜁니다.");
    return;
  }

  try {
    // 1. Firebase에서 leaves 데이터 가져오기
    const response = UrlFetchApp.fetch(LEAVES_DB_URL, { muteHttpExceptions: true });
    if (response.getResponseCode() !== 200) {
      Logger.log("❌ Firebase 휴가 데이터 로드 실패");
      return;
    }
    const leavesData = JSON.parse(response.getContentText()) || {};

    // 2. 구글 캘린더 가져오기
    let targetCal = null;
    const cals = CalendarApp.getCalendarsByName("FAWW");
    if (cals && cals.length > 0) targetCal = cals[0];
    else targetCal = CalendarApp.getDefaultCalendar();

    if (!targetCal) {
      Logger.log("⚠️ 캘린더를 찾을 수 없습니다.");
      return;
    }

    const now = new Date();
    const startDate = new Date(now.getFullYear() - 1, 0, 1);
    const endDate = new Date(now.getFullYear() + 2, 11, 31);
    const events = targetCal.getEvents(startDate, endDate);

    // 3. 현재 캘린더에 존재하는 휴가 이벤트 매핑 (ID 기준)
    const existingLeaveEvents = {};
    events.forEach(event => {
      const desc = event.getDescription() || "";
      const match = desc.match(/\[FaWW 휴가연동 ID:\s*([^\]]+)\]/);
      if (match && match[1]) {
        existingLeaveEvents[match[1]] = event;
      }
    });

    let createdCount = 0;
    let updatedCount = 0;
    let deletedCount = 0;

    // 4. Firebase 데이터를 기준으로 캘린더 업데이트 및 생성
    for (const [key, leave] of Object.entries(leavesData)) {
      // 승인된(approved) 휴가만 동기화
      if (leave.status !== 'approved') continue;

      const userName = leave.userName || leave.name || '알수없음';
      const title = leave.type === 0.5 ? `[반차] ${userName} 오전/오후` : `[휴가] ${userName} 연차`;
      const desc = `사유: ${leave.reason || '없음'}\n[FaWW 휴가연동 ID: ${key}]`;
      
      const dateStr = leave.date || leave.startDate;
      if (!dateStr) continue;

      const sDate = new Date(dateStr);
      let eDate = new Date(dateStr);
      eDate.setDate(eDate.getDate() + 1); // Exclusive

      if (existingLeaveEvents[key]) {
        const event = existingLeaveEvents[key];
        let needsUpdate = false;
        
        if (event.getTitle() !== title) { event.setTitle(title); needsUpdate = true; }
        if (event.getDescription() !== desc) { event.setDescription(desc); needsUpdate = true; }
        
        const currentStart = event.getAllDayStartDate();
        const currentEnd = event.getAllDayEndDate();
        
        if (!currentStart || !currentEnd || currentStart.getTime() !== sDate.getTime() || currentEnd.getTime() !== eDate.getTime()) {
          event.setAllDayDates(sDate, eDate);
          needsUpdate = true;
        }

        // 색상 강제 지정 (회색/검은색 계열)
        if (event.getColor() !== CalendarApp.EventColor.GRAY) {
          event.setColor(CalendarApp.EventColor.GRAY);
          needsUpdate = true;
        }
        
        if (needsUpdate) updatedCount++;
        delete existingLeaveEvents[key]; // 처리된 것은 맵에서 제거
      } else {
        // 생성
        const newEvent = targetCal.createAllDayEvent(title, sDate, eDate, { description: desc });
        newEvent.setColor(CalendarApp.EventColor.GRAY);
        createdCount++;
      }
    }

    // 5. Firebase에 없거나 승인 취소된 휴가는 캘린더에서 삭제
    for (const [key, event] of Object.entries(existingLeaveEvents)) {
      event.deleteEvent();
      deletedCount++;
    }

    Logger.log(`✅ 휴가 동기화 완료: 생성 ${createdCount}건, 수정 ${updatedCount}건, 삭제 ${deletedCount}건`);
  } catch (error) {
    Logger.log(`🔥 휴가 동기화 오류: ${error.message}`);
  }
  Logger.log("=== 🔄 FaWW 휴가 -> 구글 캘린더 동기화 종료 ===");
}
/**
 * [문제 해결용] 특정 메일 스레드의 모든 별표를 강제로 해제하는 함수
 */
function forceUnstarSpecificThread() {
  const threads = GmailApp.search('subject:"한국에너지공단 건강증진 프로그램"');
  if (threads.length > 0) {
    const thread = threads[0];
    const msgs = thread.getMessages();
    let count = 0;
    msgs.forEach(m => {
      if(m.isStarred()) {
        m.unstar();
        count++;
      }
    });
    Logger.log(`✅ [${thread.getFirstMessageSubject()}] 스레드 내의 숨겨진 별표 ${count}개를 강제로 해제했습니다! 이제 메인 스크립트를 다시 실행해보세요.`);
  } else {
    Logger.log("⚠️ 해당 제목의 메일을 찾을 수 없습니다.");
  }
}

/**
 * [문제 해결용] 방금 테스트로 꼬인 강민재님 스레드의 모든 DB 데이터를 싹 비웁니다.
 */
function deleteTestTripsFromDB_v2() {
  const baseDbUrl = FIREBASE_DB_URL.split('.json')[0];
  const authParam = FIREBASE_DB_URL.split('?')[1] || "";
  
  const existingTrips = fetchExistingTrips();
  const keys = Object.keys(existingTrips);
  
  // 강민재님 스레드 아이디 (로그에서 파악된 아이디로 유추하거나 전체를 순회)
  let deleted = 0;
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const trip = existingTrips[key];
    
    // 강민재 님 메일이거나, 이름에 본부/지역이 들어간 오늘 테스트 건들 일괄 삭제
    if (trip.assignee === "강민재" || trip.category === "텔러스헬스" || (trip.name && trip.name.includes("본부"))) {
      UrlFetchApp.fetch(`${baseDbUrl}/${key}.json?${authParam}`, { method: 'delete', muteHttpExceptions: true });
      deleted++;
    }
  }
  Logger.log(`✅ 완벽 청소 완료! 총 ${deleted}개의 꼬인 DB 데이터를 싹 다 지웠습니다. 이제 메인 함수를 돌리면 100% 신규 생성으로 깔끔하게 들어갈 겁니다!`);
}