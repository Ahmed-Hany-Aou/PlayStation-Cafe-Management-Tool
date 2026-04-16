/**
 * PlayStation Cafe Management Tool v1 - Final Release
 * Core Logic: Slot Management, Food/Drinks, Analytics
 */

// Global reference for HTML event handlers
window.app = null;

class PSCafeApp {
    constructor() {
        this.config = null;
        this.currentLang = localStorage.getItem('ps-lang') || 'en';
        this.activeSessions = JSON.parse(localStorage.getItem('ps-active')) || [];
        this.completedSessions = JSON.parse(localStorage.getItem('ps-completed')) || [];
        
        // Modal State
        this.selectedSlot = null;
        this.activeEditingSession = null;

        window.app = this;
        this.init();
    }

    async init() {
        try {
            await this.loadConfig();
            this.setupEventListeners();
            this.updateLanguageUI();
            this.renderDashboard();
            this.startTimerHub();
            
            // Hide loader
            setTimeout(() => {
                const loader = document.getElementById('loading-overlay');
                if (loader) loader.style.display = 'none';
            }, 800);

        } catch (err) {
            console.error('Initialization failed:', err);
        }
    }

    async loadConfig() {
        try {
            const response = await fetch('config.json');
            this.config = await response.json();
        } catch (e) {
            console.error('Config load failed:', e);
            throw e;
        }
    }

    startTimerHub() {
        setInterval(() => this.updateTimers(), 1000);
    }

    updateTimers() {
        this.activeSessions.forEach(session => {
            const slotBtn = document.querySelector(`.slot-btn[data-station="${session.stationId}"][data-slot="${session.slotNumber}"]`);
            if (slotBtn) {
                const elapsed = this.calculateElapsed(session.startTime);
                const timerEl = slotBtn.querySelector('.timer');
                if (timerEl) timerEl.textContent = elapsed.formatted;
            }
        });

        if (this.activeEditingSession) {
            const elapsed = this.calculateElapsed(this.activeEditingSession.startTime);
            const timerDisplay = document.getElementById('active-timer-display');
            if (timerDisplay) timerDisplay.textContent = elapsed.formatted;
            
            const station = this.config.stations.find(s => s.id === this.activeEditingSession.stationId);
            const basePrice = station ? station.pricePerHour : 0;
            const gamingTotal = (basePrice / 60) * elapsed.totalMinutes;
            
            const foodTotal = this.calculateFoodTotal(this.activeEditingSession);
            const grandTotal = gamingTotal + foodTotal;

            const gTotalEl = document.getElementById('gaming-total-display');
            const fTotalEl = document.getElementById('food-total-display');
            const grandTotalEl = document.getElementById('grand-total-display');

            if (gTotalEl) gTotalEl.textContent = `${gamingTotal.toFixed(2)} ${this.config.settings.currency}`;
            if (fTotalEl) fTotalEl.textContent = `${foodTotal.toFixed(2)} ${this.config.settings.currency}`;
            if (grandTotalEl) grandTotalEl.textContent = `${grandTotal.toFixed(2)} ${this.config.settings.currency}`;
        }
    }

    calculateElapsed(startTimeStr) {
        if (!startTimeStr) return { formatted: '00:00:00', totalMinutes: 0 };
        const start = new Date(startTimeStr);
        const now = new Date();
        const diff = Math.max(0, now - start);
        const hours = Math.floor(diff / 3600000);
        const minutes = Math.floor((diff % 3600000) / 60000);
        const seconds = Math.floor((diff % 60000) / 1000);
        return {
            formatted: `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`,
            totalMinutes: diff / 60000
        };
    }

    calculateFoodTotal(session) {
        let total = 0;
        if (!session || !session.foodCart) return 0;
        for (const [id, qty] of Object.entries(session.foodCart)) {
            const item = this.config.foodItems.find(f => f.id === id);
            if (item) total += (item.price * qty);
        }
        return total;
    }

    renderDashboard() {
        const dashboard = document.getElementById('dashboard');
        if (!dashboard || !this.config) return;
        dashboard.innerHTML = '';

        this.config.stations.forEach(station => {
            const section = document.createElement('section');
            section.className = 'station-section';
            const name = this.currentLang === 'en' ? station.nameEn : station.nameAr;
            const hrLabel = this.currentLang === 'en' ? 'hr' : 'ساعة';
            section.innerHTML = `
                <div class="station-header">
                    <div class="station-info">
                        <h2>${name}</h2>
                        <div class="price-tag">${station.pricePerHour} ${this.config.settings.currency} / ${hrLabel}</div>
                    </div>
                </div>
                <div class="slot-grid" id="grid-${station.id}"></div>
            `;
            dashboard.appendChild(section);
            this.renderSlots(station);
        });
    }

    renderSlots(station) {
        const grid = document.getElementById(`grid-${station.id}`);
        if (!grid) return;
        
        for (let i = 1; i <= station.slotsCount; i++) {
            const activeSession = this.activeSessions.find(s => s.stationId === station.id && s.slotNumber === i);
            const btn = document.createElement('div');
            btn.className = 'slot-btn';
            btn.dataset.station = station.id;
            btn.dataset.slot = i;
            const slotName = this.currentLang === 'en' ? `Device ${i}` : `جهاز ${i}`;

            if (activeSession) {
                btn.dataset.status = 'occupied';
                const elapsed = this.calculateElapsed(activeSession.startTime);
                btn.innerHTML = `<span class="slot-name">${slotName}</span><span class="timer">${elapsed.formatted}</span>`;
                btn.onclick = () => this.openManageModal(activeSession.id);
            } else {
                btn.dataset.status = 'free';
                btn.innerHTML = `<span class="slot-name">${slotName}</span>`;
                btn.onclick = () => this.openStartModal(station.id, i);
            }
            grid.appendChild(btn);
        }
    }

    renderFoodList() {
        const container = document.getElementById('food-list-container');
        if (!container || !this.activeEditingSession) return;
        container.innerHTML = '';

        this.config.foodItems.forEach(item => {
            const qty = this.activeEditingSession.foodCart?.[item.id] || 0;
            const row = document.createElement('div');
            row.className = 'food-item-row';
            row.innerHTML = `
                <div class="info">
                    <span class="name">${this.currentLang === 'en' ? item.nameEn : item.nameAr}</span>
                    <span class="price">${item.price} ${this.config.settings.currency}</span>
                </div>
                <div class="qty-controls">
                    <button class="btn-qty" onclick="window.app.updateFoodQty('${item.id}', -1)">-</button>
                    <span class="qty-val">${qty}</span>
                    <button class="btn-qty" onclick="window.app.updateFoodQty('${item.id}', 1)">+</button>
                </div>
            `;
            container.appendChild(row);
        });

        // Update Badge
        const badge = document.getElementById('food-count-badge');
        const foodCart = this.activeEditingSession.foodCart || {};
        const totalQty = Object.values(foodCart).reduce((a, b) => a + b, 0);
        if (badge) {
            badge.textContent = totalQty;
            badge.style.display = totalQty > 0 ? 'block' : 'none';
        }
    }

    updateFoodQty(foodId, delta) {
        if (!this.activeEditingSession) return;
        if (!this.activeEditingSession.foodCart) this.activeEditingSession.foodCart = {};
        
        const current = this.activeEditingSession.foodCart[foodId] || 0;
        const next = Math.max(0, current + delta);
        
        if (next === 0) delete this.activeEditingSession.foodCart[foodId];
        else this.activeEditingSession.foodCart[foodId] = next;
        
        this.saveState();
        this.renderFoodList();
        this.updateTimers();
    }

    openStartModal(stationId, slotNumber) {
        this.selectedSlot = { stationId, slotNumber };
        const modal = document.getElementById('start-modal');
        const station = this.config.stations.find(s => s.id === stationId);
        const sName = this.currentLang === 'en' ? station.nameEn : station.nameAr;
        const dName = this.currentLang === 'en' ? 'Device' : 'جهاز';
        
        const infoEl = document.getElementById('start-slot-info');
        if (infoEl) infoEl.textContent = `${sName} | ${dName} ${slotNumber}`;
        
        const timeInput = document.getElementById('start-time-input');
        if (timeInput) timeInput.value = new Date().toTimeString().slice(0, 5);
        
        const nameInput = document.getElementById('cust-name-input');
        if (nameInput) nameInput.value = '';
        
        if (modal) modal.style.display = 'flex';
    }

    openManageModal(sessionId) {
        const session = this.activeSessions.find(s => s.id === sessionId);
        if (!session) return;
        
        this.activeEditingSession = session;
        const modal = document.getElementById('manage-modal');
        const station = this.config.stations.find(s => s.id === session.stationId);
        
        const sName = this.currentLang === 'en' ? station.nameEn : station.nameAr;
        const dName = this.currentLang === 'en' ? 'Device' : 'جهاز';
        const cName = session.customerName || (this.currentLang === 'en' ? 'Walk-in' : 'نقدي');
        
        const infoEl = document.getElementById('manage-slot-info');
        if (infoEl) infoEl.textContent = `${sName} | ${dName} ${session.slotNumber} | ${cName}`;
        
        const timeInput = document.getElementById('edit-start-time-input');
        if (timeInput) timeInput.value = new Date(session.startTime).toTimeString().slice(0, 5);
        
        // Reset Food UI
        const foodListCont = document.getElementById('food-list-container');
        if (foodListCont) foodListCont.classList.add('hidden');
        this.renderFoodList();
        
        if (modal) modal.style.display = 'flex';
        this.updateTimers();
    }

    setupEventListeners() {
        const langBtn = document.getElementById('lang-toggle');
        if (langBtn) {
            langBtn.onclick = () => {
                this.currentLang = this.currentLang === 'en' ? 'ar' : 'en';
                this.updateLanguageUI();
                this.renderDashboard();
            };
        }

        document.querySelectorAll('.close-trigger').forEach(btn => {
            btn.onclick = () => {
                document.querySelectorAll('.modal-overlay').forEach(m => m.style.display = 'none');
                this.activeEditingSession = null;
            };
        });

        const toggleFood = document.getElementById('toggle-food');
        if (toggleFood) {
            toggleFood.onclick = () => {
                const list = document.getElementById('food-list-container');
                if (list) list.classList.toggle('hidden');
            };
        }

        const confirmStart = document.getElementById('confirm-start');
        if (confirmStart) confirmStart.onclick = () => this.handleStartSession();

        const updateStart = document.getElementById('update-start-btn');
        if (updateStart) updateStart.onclick = () => this.handleUpdateStartTime();

        const endSession = document.getElementById('end-session-btn');
        if (endSession) endSession.onclick = () => this.handleEndSession();
    }

    handleStartSession() {
        const timeInput = document.getElementById('start-time-input');
        if (!timeInput) return;
        
        const timeVal = timeInput.value;
        const [h, m] = timeVal.split(':');
        const startTime = new Date();
        startTime.setHours(h, m, 0, 0);

        const newSession = {
            id: Date.now(),
            stationId: this.selectedSlot.stationId,
            slotNumber: this.selectedSlot.slotNumber,
            startTime: startTime.toISOString(),
            customerName: document.getElementById('cust-name-input').value,
            foodCart: {}
        };

        this.activeSessions.push(newSession);
        this.saveState();
        this.renderDashboard();
        const startModal = document.getElementById('start-modal');
        if (startModal) startModal.style.display = 'none';
    }

    handleUpdateStartTime() {
        const timeInput = document.getElementById('edit-start-time-input');
        if (!timeInput || !this.activeEditingSession) return;
        
        const [h, m] = timeInput.value.split(':');
        const newStart = new Date(this.activeEditingSession.startTime);
        newStart.setHours(h, m, 0, 0);
        
        if (newStart > new Date()) {
            alert(this.currentLang === 'en' ? 'No future times' : 'لا يمكن اختيار وقت مستقبلي');
            return;
        }
        this.activeEditingSession.startTime = newStart.toISOString();
        this.saveState();
        this.renderDashboard();
    }

    async handleEndSession() {
        if (!this.activeEditingSession) return;
        
        const session = this.activeEditingSession;
        const station = this.config.stations.find(s => s.id === session.stationId);
        const elapsed = this.calculateElapsed(session.startTime);
        const basePrice = station ? station.pricePerHour : 0;
        const gamingTotal = (basePrice / 60) * elapsed.totalMinutes;
        const foodTotal = this.calculateFoodTotal(session);

        const foodList = [];
        if (session.foodCart) {
            for (const [id, qty] of Object.entries(session.foodCart)) {
                const item = this.config.foodItems.find(f => f.id === id);
                if (item) foodList.push({ name: item.nameEn, quantity: qty, price: item.price });
            }
        }

        const completedData = {
            ...session,
            stationName: station ? station.nameEn : 'Unknown',
            endTime: new Date().toISOString(),
            durationMinutes: Math.round(elapsed.totalMinutes),
            gamingTotal: Math.round(gamingTotal * 100) / 100,
            foodTotal: Math.round(foodTotal * 100) / 100,
            grandTotal: Math.round((gamingTotal + foodTotal) * 100) / 100,
            foodItems: foodList
        };

        this.completedSessions.push(completedData);
        this.activeSessions = this.activeSessions.filter(s => s.id !== session.id);
        this.saveState();
        this.syncToGoogle(completedData);
        this.renderDashboard();
        
        const manageModal = document.getElementById('manage-modal');
        if (manageModal) manageModal.style.display = 'none';
        this.activeEditingSession = null;
    }

    syncToGoogle(data) {
        const url = this.config.settings.googleSheetUrl;
        if (!url || url.includes('INSERT')) return;
        const payload = { ...data, foodItems: JSON.stringify(data.foodItems) };
        fetch(url, { method: 'POST', mode: 'no-cors', body: JSON.stringify(payload) })
             .catch(e => console.warn('Sync failed', e));
    }

    saveState() {
        localStorage.setItem('ps-active', JSON.stringify(this.activeSessions));
        localStorage.setItem('ps-completed', JSON.stringify(this.completedSessions));
    }

    updateLanguageUI() {
        document.documentElement.lang = this.currentLang;
        document.documentElement.dir = this.currentLang === 'ar' ? 'rtl' : 'ltr';
        const langBtn = document.getElementById('lang-toggle');
        if (langBtn) langBtn.textContent = this.currentLang === 'en' ? 'العربية' : 'English';
        
        document.querySelectorAll('[data-en]').forEach(el => {
            el.textContent = el.getAttribute(`data-${this.currentLang}`);
        });
        localStorage.setItem('ps-lang', this.currentLang);
    }
}

// Start the app which binds to window.app
new PSCafeApp();
