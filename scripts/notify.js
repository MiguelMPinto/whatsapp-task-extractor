'use strict';

// Notificacoes nativas Windows. Modos:
//   notify.js "titulo" "mensagem"   -> generico
//   notify.js --success             -> le data/todo.json e monta resumo
//   notify.js --error "<motivo>"    -> "Pipeline falhou: <motivo>"
//   notify.js --session-expired     -> alerta para correr auth.js

const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const TODO_FILE = path.join(ROOT, 'data', 'todo.json');

let notifier;
try {
    notifier = require('node-notifier');
} catch (e) {
    console.error('>> notify.js: node-notifier indisponivel (' + e.message + ')');
    console.error('>> Corre `npm install` em scripts/ para activar notificacoes.');
    process.exit(0); // nao parte o pipeline por causa de notificacao
}

function notify(title, message) {
    notifier.notify({
        title: title,
        message: message,
        appID: 'WhatsApp Todo',
        timeout: 8,
        wait: false
    }, (err) => {
        if (err) console.error('>> notify falhou:', err.message);
    });
}

function readTodoSummary() {
    try {
        const raw = fs.readFileSync(TODO_FILE, 'utf8');
        const obj = JSON.parse(raw);
        const tarefas = Array.isArray(obj.tarefas) ? obj.tarefas : [];
        const total = tarefas.length;
        const altas = tarefas.filter((t) => t && t.prioridade === 'ALTA').length;
        return { total, altas };
    } catch (_) {
        return null;
    }
}

function main() {
    const args = process.argv.slice(2);
    if (args.length === 0) {
        console.error('>> uso: notify.js "titulo" "mensagem" | --success | --error <motivo> | --session-expired');
        process.exit(1);
    }

    const mode = args[0];

    if (mode === '--success') {
        const s = readTodoSummary();
        if (s) {
            notify('TODO atualizada', `${s.total} tarefas detetadas (${s.altas} de alta prioridade)`);
        } else {
            notify('TODO atualizada', 'Pipeline correu (sem detalhes do todo.json)');
        }
        return;
    }

    if (mode === '--error') {
        const motivo = args[1] || 'erro desconhecido';
        notify('Pipeline falhou', `${motivo} (ver logs/)`);
        return;
    }

    if (mode === '--session-expired') {
        notify('Sessao WhatsApp expirou', 'Corre `npm run auth` em scraper/ para re-autenticar.');
        return;
    }

    // Modo generico: titulo + mensagem
    const title = args[0];
    const message = args[1] || '';
    notify(title, message);
}

main();
