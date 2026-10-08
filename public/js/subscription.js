window.AppSubscriptionManager = {
    subs: {},
    sessionGen: 0,
    subscribe: function(key, queryRef, callback) {
        if (this.subs[key]) {
            this.unsubscribe(key);
        }
        
        let subToken = {}; // Unique object reference for this specific subscription call
        
        let wrappedCallback = (snapshot) => {
            // Check if this specific subscription call is still the active one for this key
            if (!this.subs[key] || this.subs[key].token !== subToken) {
                return;
            }
            callback(snapshot);
        };
        
        this.subs[key] = { 
            ref: queryRef, 
            cb: wrappedCallback, 
            token: subToken,
            gen: this.sessionGen // We can keep gen for any other purposes, but token handles identity
        };
        
        queryRef.on('value', wrappedCallback, (err) => {
            console.error("[AppSubscriptionManager] Listener " + key + " error:", err);
        });
    },
    unsubscribe: function(key) {
        if (this.subs[key]) {
            this.subs[key].ref.off('value', this.subs[key].cb);
            delete this.subs[key];
        }
    },
    unsubscribeAllExcept: function(exceptKeys = []) {
        this.sessionGen++; // increment generation to track major state boundaries
        for (let key in this.subs) {
            if (!exceptKeys.includes(key)) {
                this.unsubscribe(key);
            } else {
                // We keep the exact same subToken, so its callback will still pass the check!
                this.subs[key].gen = this.sessionGen; 
            }
        }
    },
    unsubscribeAll: function() {
        this.unsubscribeAllExcept([]);
    }
};
