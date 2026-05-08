'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TMP = path.join(ROOT, 'data', 'todo.json.tmp');
const FINAL = path.join(ROOT, 'data', 'todo.json');
const LOG = path.join(ROOT, 'logs', 'analyzer.log');

const PRIORIDADES = new Set(['ALTA', 'MEDIA', 'BAIXA']);
const CATEGORIAS = new Set(['Trabalho', 'Pessoal', 'Família', 'Saúde', 'Finanças', 'Social']);
const TIPOS = new Set(['promessa', 'pedido_pendente', 'compromisso', 'deadline', 'follow_up']);
const RE_DATA = /^\d{4}-\d{2}-\d{2}$/;
const RE_HORA = /^\d{2}:\d{2}$/;
const SOFT_LIMIT_TAREFAS = 50;

function logErr(msg) {
    const line = `[${new Date().toISOString()}] validate.js: ${msg}\n`;
    try { fs.appendFileSync(LOG, line); } catch (_) { /* logs/ deve existir */ }
    console.error(`>> ${msg}`);
}

function fail(msg) {
    logErr(msg);
    try { if (fs.existsSync(TMP)) fs.unlinkSync(TMP); } catch (_) {}
    process.exit(1);
}

function isStr(v) { return typeof v === 'string'; }
function isInt(v) { return Number.isInteger(v); }

function validateTarefa(t, i) {
    const where = `tarefas[${i}]`;
    if (!t || typeof t !== 'object') return `${where}: nao e objecto`;
    if (!isInt(t.id) || t.id < 1) return `${where}.id invalido (esperado inteiro >=1)`;
    if (!isStr(t.titulo) || t.titulo.length === 0) return `${where}.titulo invalido`;
    if (!isStr(t.descricao)) return `${where}.descricao invalido`;
    if (!PRIORIDADES.has(t.prioridade)) return `${where}.prioridade invalido (${t.prioridade})`;
    if (!CATEGORIAS.has(t.categoria)) return `${where}.categoria invalido (${t.categoria})`;
    if (!TIPOS.has(t.tipo)) return `${where}.tipo invalido (${t.tipo})`;
    if (t.prazo !== null && !(isStr(t.prazo) && RE_DATA.test(t.prazo))) {
        return `${where}.prazo invalido (esperado YYYY-MM-DD ou null)`;
    }
    if (t.hora !== null && !(isStr(t.hora) && RE_HORA.test(t.hora))) {
        return `${where}.hora invalido (esperado HH:MM ou null)`;
    }
    if (!isStr(t.pessoa)) return `${where}.pessoa invalido`;
    if (!isStr(t.conversa_origem)) return `${where}.conversa_origem invalido`;
    if (!isStr(t.extracto_mensagem)) return `${where}.extracto_mensagem invalido`;
    if (!isInt(t.confianca) || t.confianca < 0 || t.confianca > 100) {
        return `${where}.confianca invalido (esperado inteiro 0-100)`;
    }
    return null;
}

function main() {
    if (!fs.existsSync(TMP)) {
        fail(`ficheiro candidato nao existe: ${TMP} (claude --print nao escreveu o output?)`);
    }

    let raw;
    try {
        raw = fs.readFileSync(TMP, 'utf8');
    } catch (e) {
        fail(`falha a ler ${TMP}: ${e.message}`);
    }

    let obj;
    try {
        obj = JSON.parse(raw);
    } catch (e) {
        fail(`JSON malformado em ${TMP}: ${e.message}`);
    }

    if (!obj || typeof obj !== 'object') fail('raiz do JSON nao e objecto');
    if (!isStr(obj.data_geracao)) fail('campo data_geracao em falta ou invalido');
    if (!isStr(obj.versao_prompt)) fail('campo versao_prompt em falta ou invalido');
    if (!isInt(obj.total_conversas_analisadas) || obj.total_conversas_analisadas < 0) {
        fail('campo total_conversas_analisadas invalido');
    }
    if (!isInt(obj.total_mensagens_processadas) || obj.total_mensagens_processadas < 0) {
        fail('campo total_mensagens_processadas invalido');
    }
    if (!Array.isArray(obj.tarefas)) fail('campo tarefas tem de ser array');

    for (let i = 0; i < obj.tarefas.length; i++) {
        const err = validateTarefa(obj.tarefas[i], i);
        if (err) fail(err);
    }

    if (obj.tarefas.length > SOFT_LIMIT_TAREFAS) {
        logErr(`AVISO: ${obj.tarefas.length} tarefas (>${SOFT_LIMIT_TAREFAS}) — possivel ruido na extraccao`);
    }

    try {
        fs.renameSync(TMP, FINAL);
    } catch (e) {
        fail(`falha a promover ${TMP} -> ${FINAL}: ${e.message}`);
    }

    console.log(`>> validate: ${obj.tarefas.length} tarefas, todo.json escrito.`);
    process.exit(0);
}

main();
