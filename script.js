window.app = null;

class PSCafeApp {
    constructor() {
        this.config = null;
        this.currentLang = localStorage.getItem('ps-lang') || 'en';
        this.activeSessions = JSON.parse(localStorage.getItem('ps-active')) || [];
        this.completedSessions = JSON.parse(localStorage.getItem('ps-completed')) || [];
        this.pendingSync = JSON.parse(localStorage.getItem('ps-pending')) || []; // Sync queue

        this.selectedSlot = null;
        this.activeEditingSession = null;
        window.app = this;
        this.init();
    }

    async init() {
        try {
            const res = await fetch('config.json');
            this.config = await res.json();
            this.setupEventListeners();
            this.updateLanguageUI();
            this.renderDashboard();

            // Core Background Jobs
            setInterval(() => this.updateTimers(), 1000);

            // Sync Queue: Initial flush + periodic retry (1hr)
            this.flushQueue();
            setInterval(() => this.flushQueue(), 3600000);

            // Retry on restoration of internet
            window.addEventListener('online', () => this.flushQueue());

            setTimeout(() => document.getElementById('loading-overlay').style.display = 'none', 800);
        } catch (err) { console.error('Init failed', err); }
    }

    // --- SYNC QUEUE ENGINE ---
    async flushQueue() {
        if (!navigator.onLine || this.pendingSync.length === 0) return;

        const url = this.config.settings.googleSheetUrl;
        if (!url || url.includes('https://script.google.com/macros/s/AKfycbxTYzQcvoPt7fsxoUrBi4YU5zpIjroYbZu2LIHcsmFYs-tsPu5Ik99sUo9tpZ0nlZY/exec')) return;

        console.log(`Syncing ${this.pendingSync.length} pending sessions...`);

        // Process in local copies to avoid mutation issues during async
        const queueToProcess = [...this.pendingSync];

        for (const session of queueToProcess) {
            try {
                // We don't use no-cors here because we want to know if it succeeded 
                // However, Google Apps Script redirection often fails with CORS. 
                // 'no-cors' is safer for Apps Script but prevents us from seeing content. 
                // We'll use 'no-cors' but remove from queue immediately as it's the "best effort" delivery.
                await fetch(url, {
                    method: 'POST',
                    mode: 'no-cors',
                    body: JSON.stringify(session)
                });

                // Remove from the master queue after attempt
                this.pendingSync = this.pendingSync.filter(s => s.id !== session.id);
                this.saveState();
            } catch (err) {
                console.warn('Sync failed for item, keeping in queue:', session.id);
            }
        }
    }

    updateTimers() {
        this.activeSessions.forEach(session => {
            const el = document.querySelector(`.slot-btn[data-station="${session.stationId}"][data-slot="${session.slotNumber}"] .timer`);
            if (el) el.textContent = this.calculateElapsed(session.startTime).formatted;
        });

        if (this.activeEditingSession) {
            const elapsed = this.calculateElapsed(this.activeEditingSession.startTime);
            document.getElementById('active-timer-display').textContent = elapsed.formatted;
            const station = this.config.stations.find(s => s.id === this.activeEditingSession.stationId);
            const gTotal = ((station ? station.pricePerHour : 0) / 60) * elapsed.totalMinutes;
            const fTotal = this.calculateFoodTotal(this.activeEditingSession);
            document.getElementById('gaming-total-display').textContent = `${gTotal.toFixed(2)} EGP`;
            document.getElementById('food-total-display').textContent = `${fTotal.toFixed(2)} EGP`;
            document.getElementById('grand-total-display').textContent = `${(gTotal + fTotal).toFixed(2)} EGP`;
        }
    }

    calculateElapsed(startStr) {
        const diff = Math.max(0, new Date() - new Date(startStr));
        const hrs = Math.floor(diff / 3600000);
        const mins = Math.floor((diff % 3600000) / 60000);
        const secs = Math.floor((diff % 60000) / 1000);
        return { formatted: `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`, totalMinutes: diff / 60000 };
    }

    calculateFoodTotal(session) {
        let t = 0;
        Object.entries(session.foodCart || {}).forEach(([id, q]) => {
            const item = this.config.foodItems.find(f => f.id === id);
            if (item) t += item.price * q;
        });
        return t;
    }

    renderDashboard() {
        const db = document.getElementById('dashboard');
        db.innerHTML = '';
        this.config.stations.forEach(st => {
            const sec = document.createElement('section');
            sec.className = 'station-section';
            sec.innerHTML = `<div class="station-header"><h2>${this.currentLang === 'en' ? st.nameEn : st.nameAr}</h2></div><div class="slot-grid" id="grid-${st.id}"></div>`;
            db.appendChild(sec);
            const grid = document.getElementById(`grid-${st.id}`);
            for (let i = 1; i <= st.slotsCount; i++) {
                const s = this.activeSessions.find(as => as.stationId === st.id && as.slotNumber === i);
                const b = document.createElement('div');
                b.className = 'slot-btn';
                b.dataset.status = s ? 'occupied' : 'free';
                b.setAttribute('data-station', st.id);
                b.setAttribute('data-slot', i);
                b.innerHTML = `<span class="slot-name">${this.currentLang === 'en' ? 'Device' : 'جهاز'} ${i}</span>${s ? '<span class="timer">00:00:00</span>' : ''}`;
                b.onclick = () => s ? this.openManageModal(s.id) : this.openStartModal(st.id, i);
                grid.appendChild(b);
            }
        });
    }

    renderFoodList() {
        const cont = document.getElementById('food-list-container');
        cont.innerHTML = '';
        this.config.foodItems.forEach(it => {
            const q = this.activeEditingSession.foodCart?.[it.id] || 0;
            const div = document.createElement('div');
            div.className = 'food-item-row';
            const priceLabel = `${it.price} ${this.config.settings.currency}`;
            div.innerHTML = `<div class="info"><span class="name">${this.currentLang === 'en' ? it.nameEn : it.nameAr}</span> <span style="font-size:0.8rem; color:var(--ps-amber)">(${priceLabel})</span></div><div class="qty-controls"><button class="btn-qty" onclick="window.app.updateFoodQty('${it.id}',-1)">-</button><span class="qty-val">${q}</span><button class="btn-qty" onclick="window.app.updateFoodQty('${it.id}',1)">+</button></div>`;
            cont.appendChild(div);
        });
        const totalQ = Object.values(this.activeEditingSession.foodCart || {}).reduce((a, b) => a + b, 0);
        document.getElementById('food-count-badge').style.display = totalQ > 0 ? 'block' : 'none';
        document.getElementById('food-count-badge').textContent = totalQ;
    }

    updateFoodQty(fid, d) {
        if (!this.activeEditingSession.foodCart) this.activeEditingSession.foodCart = {};
        const n = Math.max(0, (this.activeEditingSession.foodCart[fid] || 0) + d);
        if (n === 0) delete this.activeEditingSession.foodCart[fid]; else this.activeEditingSession.foodCart[fid] = n;
        this.saveState(); this.renderFoodList(); this.updateTimers();
    }

    openStartModal(sid, sl) {
        this.selectedSlot = { sid, sl };
        document.getElementById('start-time-input').value = new Date().toTimeString().slice(0, 5);
        document.getElementById('start-modal').style.display = 'flex';
    }

    openManageModal(sid) {
        this.activeEditingSession = this.activeSessions.find(s => s.id === sid);
        document.getElementById('edit-start-time-input').value = new Date(this.activeEditingSession.startTime).toTimeString().slice(0, 5);
        document.getElementById('manage-modal').style.display = 'flex';
        this.renderFoodList();
    }

    setupEventListeners() {
        document.getElementById('lang-toggle').onclick = () => { this.currentLang = this.currentLang === 'en' ? 'ar' : 'en'; this.updateLanguageUI(); this.renderDashboard(); };
        document.querySelectorAll('.close-trigger').forEach(b => b.onclick = () => { document.querySelectorAll('.modal-overlay').forEach(m => m.style.display = 'none'); this.activeEditingSession = null; });
        document.getElementById('toggle-food').onclick = () => document.getElementById('food-list-container').classList.toggle('hidden');
        document.getElementById('confirm-start').onclick = () => {
            const [h, m] = document.getElementById('start-time-input').value.split(':');
            const d = new Date(); d.setHours(h, m, 0, 0);
            this.activeSessions.push({ id: Date.now(), stationId: this.selectedSlot.sid, slotNumber: this.selectedSlot.sl, startTime: d.toISOString(), customerName: document.getElementById('cust-name-input').value, foodCart: {} });
            this.saveState(); this.renderDashboard(); document.getElementById('start-modal').style.display = 'none';
        };
        document.getElementById('update-start-btn').onclick = () => {
            const [h, m] = document.getElementById('edit-start-time-input').value.split(':');
            const d = new Date(this.activeEditingSession.startTime); d.setHours(h, m, 0, 0);
            this.activeEditingSession.startTime = d.toISOString(); this.saveState(); this.renderDashboard();
        };
        document.getElementById('end-session-btn').onclick = () => {
            const s = this.activeEditingSession;
            const st = this.config.stations.find(x => x.id === s.stationId);
            const el = this.calculateElapsed(s.startTime);
            const gt = (st.pricePerHour / 60) * el.totalMinutes;
            const ft = this.calculateFoodTotal(s);

            const sessionResult = {
                ...s,
                stationName: this.currentLang === 'en' ? st.nameEn : st.nameAr,
                endTime: new Date().toISOString(),
                gamingTotal: Math.round(gt),
                foodTotal: Math.round(ft),
                grandTotal: Math.round(gt + ft)
            };

            this.completedSessions.push(sessionResult);
            this.activeSessions = this.activeSessions.filter(x => x.id !== s.id);

            // Add to sync queue
            this.pendingSync.push(sessionResult);

            this.saveState();
            this.renderDashboard();
            document.getElementById('manage-modal').style.display = 'none';
            this.activeEditingSession = null;

            // Immediate attempt to flush
            this.flushQueue();
        };
    }

    saveState() {
        localStorage.setItem('ps-active', JSON.stringify(this.activeSessions));
        localStorage.setItem('ps-completed', JSON.stringify(this.completedSessions));
        localStorage.setItem('ps-pending', JSON.stringify(this.pendingSync));
    }

    updateLanguageUI() {
        document.documentElement.dir = this.currentLang === 'ar' ? 'rtl' : 'ltr';
        document.querySelectorAll('[data-en]').forEach(el => el.textContent = el.getAttribute(`data-${this.currentLang}`));
        localStorage.setItem('ps-lang', this.currentLang);
    }
}

new PSCafeApp();