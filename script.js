// =========================================================
// 1. BASE DE DATOS EXTERNA (Con Cuentas Bloqueadas e Historial)
// =========================================================
const Database = {
    users: {
        "c.advincula": { pass: "Cris#2026", account: "1001001", token: "7890", balance: 1500.00, txStatus: "BLOCKED", name: "Cristian Advíncula", history: [] },
        "c.calderon":  { pass: "Cesar#2026", account: "1002002", token: "4567", balance: 2100.50, txStatus: "ACTIVE", name: "César Calderón", history: [] },
        "d.camacho":   { pass: "Diego#2026", account: "1003003", token: "1234", balance: 500.00, txStatus: "ACTIVE", name: "Diego Camacho", history: [] },
        "a.carhuas":   { pass: "Angel#2026", account: "1004004", token: "2468", balance: 8000.00, txStatus: "BLOCKED", name: "Ángel Carhuas", history: [] },
        "a.cruz":      { pass: "Arnold#2026", account: "1005005", token: "1357", balance: 12000000.20, txStatus: "ACTIVE", name: "Arnold Cruz", history: [] },
        "d.huacachino":{ pass: "Huaca#2026", account: "1006006", token: "9876", balance: 12500.00, txStatus: "ACTIVE", name: "Diego Huacachino", history: [] }
    },
    
    getAccountOwner: function(accNumber) {
        return Object.values(this.users).find(u => u.account === accNumber);
    },

    addHistoryRecord: function(userCode, type, amount, detail, receiptData = null) {
        const date = new Date();
        const dateStr = `${date.getDate().toString().padStart(2,'0')}/${(date.getMonth()+1).toString().padStart(2,'0')} ${date.getHours().toString().padStart(2,'0')}:${date.getMinutes().toString().padStart(2,'0')}`;
        const normalizedReceipt = { time: dateStr, ...(receiptData || {}) };
        const record = { type, amount, detail, date: dateStr, receiptData: normalizedReceipt };
        this.users[userCode].history.unshift(record);
        
        // Mantener el historial limpio (máximo 15 registros para evitar desbordes visuales)
        if(this.users[userCode].history.length > 15) {
            this.users[userCode].history.pop();
        }

        return record;
    }
};

const initMockHistory = () => {
    Object.keys(Database.users).forEach(key => {
        Database.addHistoryRecord(key, 'in', 2500, 'Abono de Nómina');
        Database.addHistoryRecord(key, 'out', 45.50, 'Pago Servicio Internet');
    });
};
initMockHistory();

const currencyFormatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// =========================================================
// 2. UTILIDADES SISTEMA (Logger, Toast, FSM)
// =========================================================
class Logger {
    constructor() {
        this.terminal = document.getElementById('terminal');
        document.getElementById('btn-clear-logs').addEventListener('click', () => this.clear());
    }
    print(msg, type = 'info') {
        const timeStr = new Date().toISOString().substring(11, 23);
        this.terminal.innerHTML += `<div class="log-line log-${type}"><span class="log-time">[${timeStr}]</span> ${msg}</div>`;
        this.terminal.scrollTop = this.terminal.scrollHeight;
    }
    clear() { this.terminal.innerHTML = ''; }
}
const serverLog = new Logger();

class ToastManager {
    static show(message, type = 'info') {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        let icon = type === 'error' ? 'ri-error-warning-line' : type === 'success' ? 'ri-checkbox-circle-line' : 'ri-alert-line';
        toast.innerHTML = `<i class="${icon}"></i> <span>${message}</span>`;
        container.appendChild(toast);
        setTimeout(() => toast.classList.add('show'), 10);
        setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 400); }, 4000);
    }
}

class FSMController {
    constructor() {
        this.currentState = 'CREADA';
        this.nodes = document.querySelectorAll('.fsm-horizontal .node');
    }
    updateState(newState) {
        this.nodes.forEach(node => node.classList.remove('active', 'approved', 'rejected'));
        this.currentState = newState;
        const targetNode = document.getElementById(`st-${newState}`);
        if (targetNode) targetNode.classList.add('active');
        serverLog.print(`FSM Tracker -> Transición al Nodo [${newState}]`, 'system');
    }
    reset() { this.updateState('CREADA'); }
}
const fsm = new FSMController();

// =========================================================
// 3. CORE BANCARIO (Lógica y App)
// =========================================================
class BankSystem {
    constructor() {
        this.currentUser = null;
        this.tokenAttempts = 1;
        this.isProcessing = false;

        this.initEvents();
        this.initReceiptModal();
        this.updateClock(); setInterval(() => this.updateClock(), 60000);
    }

    initEvents() {
        document.getElementById('form-login').addEventListener('submit', (e) => this.handleLogin(e));
        document.getElementById('btn-logout').addEventListener('click', () => this.handleLogout());
        document.getElementById('form-transfer').addEventListener('submit', (e) => { e.preventDefault(); this.startTransaction(false); });
        document.getElementById('btn-concurrency').addEventListener('click', () => this.startTransaction(true));
    }

    updateClock() {
        const now = new Date();
        document.getElementById('clock').innerText = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    }

    initReceiptModal() {
        const modal = document.getElementById('receipt-modal');
        document.getElementById('btn-close-receipt').addEventListener('click', () => this.closeReceipt());
        modal.addEventListener('click', (e) => {
            if (e.target.id === 'receipt-modal') this.closeReceipt();
        });
    }

    openReceipt(tx) {
        const modal = document.getElementById('receipt-modal');
        const isIncome = tx.type === 'in';
        const receiptData = tx.receiptData || {};

        document.getElementById('receipt-title').innerText = isIncome ? 'Transferencia recibida' : 'Transferencia enviada';
        document.getElementById('receipt-recipient').innerText = receiptData.recipientName || tx.detail;
        document.getElementById('receipt-amount').innerText = `${isIncome ? '+' : '-'}${currencyFormatter.format(tx.amount)}`;
        document.getElementById('receipt-sender').innerText = receiptData.senderName || 'NexusBank';
        document.getElementById('receipt-time').innerText = receiptData.time || tx.date;

        document.body.classList.add('receipt-open');
        modal.classList.remove('hidden');
    }

    closeReceipt() {
        document.getElementById('receipt-modal').classList.add('hidden');
        document.body.classList.remove('receipt-open');
    }

    setButtonLoading(btnId, isLoading) {
        const btn = document.getElementById(btnId);
        btn.disabled = isLoading;
        if (isLoading) {
            btn.querySelector('.btn-text').classList.add('hidden');
            btn.querySelector('.spinner').classList.remove('hidden');
        } else {
            btn.querySelector('.btn-text').classList.remove('hidden');
            btn.querySelector('.spinner').classList.add('hidden');
        }
    }

    // --- AUTENTICACIÓN ---
    async handleLogin(e) {
        e.preventDefault();
        const userCode = document.getElementById('login-user').value;
        const pass = document.getElementById('login-pass').value;

        if (!userCode || !pass) { ToastManager.show('Ingrese sus credenciales completas.', 'warn'); return; }

        this.setButtonLoading('btn-login', true);
        await delay(800);

        const userObj = Database.users[userCode];
        if (!userObj || userObj.pass !== pass) {
            ToastManager.show('Credenciales incorrectas.', 'error');
            this.setButtonLoading('btn-login', false); return;
        }

        this.tokenAttempts = 1; 
        this.currentUser = userCode;
        
        document.getElementById('current-user-name').innerText = userObj.name.split(' ')[0]; // Mostrar solo el primer nombre
        this.updateBalanceUI();
        this.renderHistory();

        document.getElementById('view-login').classList.remove('active');
        document.getElementById('view-dashboard').classList.add('active');
        
        ToastManager.show(`Acceso autorizado, ${userObj.name}`, 'success');
        serverLog.print(`Sesión segura iniciada: ${userCode}`, 'success');
        this.setButtonLoading('btn-login', false);
        fsm.reset();
    }

    handleLogout() {
        this.currentUser = null;
        this.closeReceipt();
        document.getElementById('form-login').reset();
        document.getElementById('form-transfer').reset();
        document.getElementById('history-list').innerHTML = '<div class="empty-state">Inicie sesión para visualizar datos.</div>';
        document.getElementById('view-dashboard').classList.remove('active');
        document.getElementById('view-login').classList.add('active');
        fsm.reset();
        serverLog.clear();
        serverLog.print('Sistema reiniciado. Esperando conexión cliente...', 'info');
    }

    updateBalanceUI() {
        const balance = Database.users[this.currentUser].balance;
        document.getElementById('ui-balance').innerText = currencyFormatter.format(balance);
    }

    renderHistory() {
        const list = document.getElementById('history-list');
        const historyData = Database.users[this.currentUser].history;
        list.innerHTML = '';

        if(historyData.length === 0) {
            list.innerHTML = '<div class="empty-state">Sin movimientos recientes.</div>'; return;
        }

        historyData.forEach((tx, index) => {
            const isIncome = tx.type === 'in';
            const sign = isIncome ? '+' : '-';
            const colorClass = isIncome ? 'positive' : '';
            
            list.innerHTML += `
                <li class="history-item ${tx.type}">
                    <div class="hist-details">
                        <p>${tx.detail}</p>
                        <small>${tx.date}</small>
                    </div>
                    <div class="hist-actions">
                        <span class="hist-amount ${colorClass}">${sign}${currencyFormatter.format(tx.amount)}</span>
                        <button type="button" class="history-receipt-btn" data-index="${index}">Comprobante</button>
                    </div>
                </li>
            `;
        });

        list.querySelectorAll('.history-receipt-btn').forEach(button => {
            button.addEventListener('click', () => {
                const tx = historyData[Number(button.dataset.index)];
                if (tx) this.openReceipt(tx);
            });
        });
    }

    // --- PIPELINE FSM ---
    async startTransaction(forceConcurrency = false) {
        if (this.isProcessing || fsm.currentState !== 'CREADA') {
            serverLog.print('[MUTEX] Bloqueo FSM: Prevención de ejecución paralela activa.', 'error');
            return;
        }

        const destAcc = document.getElementById('transfer-dest').value;
        const amount = parseFloat(document.getElementById('transfer-amount').value);
        const pin = document.getElementById('transfer-pin').value;
        const userObj = Database.users[this.currentUser];

        if (!destAcc || isNaN(amount) || !pin) { ToastManager.show('Formulario incompleto.', 'warn'); return; }

        this.isProcessing = true;
        this.setButtonLoading('btn-transfer', true);
        serverLog.print('--- PIPELINE FSM INICIADO (SECUENCIAL) ---', 'system');

        if (forceConcurrency) { setTimeout(() => this.startTransaction(false), 50); }

        fsm.updateState('VALIDANDO');
        
        // 1. DESTINO
        await delay(600);
        const destObj = Database.getAccountOwner(destAcc);
        if (!destObj) {
            ToastManager.show('Destinatario no encontrado en el sistema.', 'warn');
            serverLog.print('Fallo FSM: Verificación de destinatario = 0.', 'warn');
            this.resetTransactionState(); return;
        }
        if (destAcc === userObj.account) {
            ToastManager.show('No es posible transferir a la cuenta de origen.', 'warn');
            this.resetTransactionState(); return;
        }

        // 2. TOKEN
        await delay(600);
        if (pin !== userObj.token) {
            if (this.tokenAttempts >= 3) {
                fsm.updateState('RECHAZADA'); 
                userObj.txStatus = 'BLOCKED';
                ToastManager.show('Firma bloqueada por intentos excedidos.', 'error');
                serverLog.print('Fallo FSM Crítico: Token inválido (Intento 3/3). Cuenta bloqueada.', 'error');
                this.isProcessing = false; this.setButtonLoading('btn-transfer', false);
                return;
            } else {
                ToastManager.show(`Token erróneo. Intento ${this.tokenAttempts}/3`, 'error');
                this.tokenAttempts++;
                this.resetTransactionState(); return;
            }
        }

        // 3. FONDOS Y ESTADO
        await delay(600);
        if (userObj.txStatus === 'BLOCKED') {
            fsm.updateState('RECHAZADA');
            ToastManager.show('Su cuenta tiene restricciones para enviar fondos.', 'error');
            serverLog.print('Excepción de Sistema: Cuenta de origen con status BLOCKED.', 'error');
            this.isProcessing = false; this.setButtonLoading('btn-transfer', false);
            return;
        }

        if (amount > userObj.balance) {
            ToastManager.show('Saldo insuficiente para procesar la orden.', 'warn');
            serverLog.print('Fallo FSM: Saldo evaluado = 0.', 'warn');
            this.resetTransactionState(); return;
        }

        // 4. APROBACIÓN
        this.tokenAttempts = 1; 
        fsm.updateState('APROBADA');
        serverLog.print('Ecuación Booleana F(A,B,C) = 1. Reteniendo fondos...', 'success');
        await delay(1200);
        
        // Liquidación
        userObj.balance -= amount;
        destObj.balance += amount;
        
        const outTx = Database.addHistoryRecord(this.currentUser, 'out', amount, `Transferencia a ${destObj.name}`, {
            senderName: userObj.name,
            recipientName: destObj.name
        });
        const destCode = Object.keys(Database.users).find(key => Database.users[key].account === destAcc);
        Database.addHistoryRecord(destCode, 'in', amount, `Transferencia de ${userObj.name}`, {
            senderName: userObj.name,
            recipientName: destObj.name
        });

        this.updateBalanceUI();
        this.renderHistory();
        this.openReceipt(outTx);
        document.getElementById('form-transfer').reset();
        
        fsm.updateState('CONCILIADA');
        serverLog.print(`Liquidación exitosa de $${amount} a cuenta terminación ${destAcc.slice(-4)}.`, 'success');
        ToastManager.show('Transferencia completada y liquidada', 'success');
        
        setTimeout(() => this.resetTransactionState(), 4000);
    }

    resetTransactionState() {
        this.isProcessing = false;
        this.setButtonLoading('btn-transfer', false);
        fsm.reset(); 
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const App = new BankSystem();
    serverLog.print('Arquitectura cargada. Entorno listo para operar.', 'system');
});
