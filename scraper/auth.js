// Autenticação única no WhatsApp Web.
// Corre interativamente, mostra QR no terminal, guarda sessão em ../session/.
// Depois desta execução, scrape.js já não precisa de QR.

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const path = require('path');

const SESSION_DIR = path.resolve(__dirname, '..', 'session');

const client = new Client({
  authStrategy: new LocalAuth({
    clientId: 'main',
    dataPath: SESSION_DIR,
  }),
  puppeteer: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  },
});

client.on('qr', (qr) => {
  console.log('\n>> Faz scan deste QR no WhatsApp do telemovel:');
  console.log('   (Definicoes -> Aparelhos ligados -> Ligar um aparelho)\n');
  qrcode.generate(qr, { small: true });
});

client.on('authenticated', () => {
  console.log('>> Autenticado.');
});

client.on('auth_failure', (msg) => {
  console.error('>> Falha de autenticacao:', msg);
  process.exit(1);
});

client.on('ready', async () => {
  console.log('>> Cliente pronto. Sessao guardada em', SESSION_DIR);
  await client.destroy();
  process.exit(0);
});

client.initialize();
