// Extrai mensagens das ultimas 48h e escreve data/conversas.txt.
// Reusa a sessao guardada por auth.js. Headless. Termina sozinho.

const { Client, LocalAuth } = require('whatsapp-web.js');
const fs = require('fs');
const path = require('path');

const SESSION_DIR = path.resolve(__dirname, '..', 'session');
const OUTPUT_FILE = path.resolve(__dirname, '..', 'data', 'conversas.txt');
const IGNORE_FILE = path.resolve(__dirname, 'ignore.json');
const WINDOW_MS = 48 * 60 * 60 * 1000; // 48h rolling

const ignore = JSON.parse(fs.readFileSync(IGNORE_FILE, 'utf8'));
const cutoff = Date.now() - WINDOW_MS;

function isIgnored(chat) {
  if (ignore.ids.includes(chat.id._serialized)) return true;
  const name = (chat.name || '').toLowerCase();
  return ignore.nameContains.some((s) => name.includes(s.toLowerCase()));
}

function fmtTime(unixSec) {
  const d = new Date(unixSec * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
}

async function extractMessages(chat) {
  // Buscar ate 200 mensagens; filtrar por janela e por tipo texto.
  const raw = await chat.fetchMessages({ limit: 200 });
  const msgs = [];
  for (const m of raw) {
    if (m.timestamp * 1000 < cutoff) continue;
    if (m.type !== 'chat') continue; // ignora midia, stickers, calls, system
    const body = (m.body || '').trim();
    if (!body) continue;

    let autor;
    if (m.fromMe) {
      autor = 'Eu';
    } else if (chat.isGroup) {
      const contact = await m.getContact();
      autor = contact.pushname || contact.name || contact.number || 'Desconhecido';
    } else {
      autor = chat.name || 'Desconhecido';
    }
    msgs.push({ ts: m.timestamp, autor, body });
  }
  msgs.sort((a, b) => a.ts - b.ts);
  return msgs;
}

const client = new Client({
  authStrategy: new LocalAuth({ clientId: 'main', dataPath: SESSION_DIR }),
  puppeteer: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  },
});

client.on('auth_failure', (msg) => {
  console.error('>> Sessao invalida. Corre `npm run auth` outra vez.', msg);
  process.exit(2);
});

client.on('disconnected', (reason) => {
  console.error('>> Desligado:', reason);
  process.exit(3);
});

client.on('ready', async () => {
  console.log('>> Ligado. A buscar conversas...');
  try {
    const chats = await client.getChats();
    const relevantes = chats.filter((c) => {
      if (isIgnored(c)) return false;
      // Atividade recente: ultima mensagem dentro da janela
      const ts = (c.lastMessage && c.lastMessage.timestamp) || c.timestamp || 0;
      return ts * 1000 >= cutoff;
    });
    console.log(`>> ${chats.length} chats no total, ${relevantes.length} dentro da janela e nao ignorados.`);

    const blocos = [];
    for (const chat of relevantes) {
      const msgs = await extractMessages(chat);
      if (msgs.length === 0) continue;
      const header = chat.isGroup ? `### Grupo: ${chat.name}` : `### Conversa: ${chat.name}`;
      const linhas = msgs.map((m) => `[${m.autor}] (${fmtTime(m.ts)}): ${m.body}`);
      blocos.push(`${header}\n${linhas.join('\n')}`);
    }

    const cabecalho = `# Conversas WhatsApp — ultimas 48h\n# Gerado: ${new Date().toISOString()}\n# Chats com mensagens: ${blocos.length}\n\n`;
    fs.writeFileSync(OUTPUT_FILE, cabecalho + blocos.join('\n\n') + '\n', 'utf8');
    console.log(`>> Escrito ${OUTPUT_FILE} (${blocos.length} chats com texto).`);
  } catch (err) {
    console.error('>> Erro:', err);
    process.exitCode = 1;
  } finally {
    await client.destroy();
  }
});

client.initialize();
