# WhatsApp Task Extractor

Pipeline automática que, ao arranque do Windows, extrai mensagens das últimas 48h do WhatsApp Web, usa Claude Code para identificar tarefas, e disponibiliza-as numa UI local em `http://127.0.0.1:8080`.

## O que faz

```
[scraper]  ──► data/conversas.txt
    │
    ▼
[analyzer] ──► data/todo.json     (Claude Sonnet 4.6 + validate.js)
    │
    ▼
[ui server] ─► http://127.0.0.1:8080
```

Tudo orquestrado por `start.bat` (silencioso, para Task Scheduler) ou `run-now.bat` (visível, manual).

## Pré-requisitos

- **Windows 10/11**
- **Node.js** 18+ no PATH (`node --version`)
- **Claude Code CLI** instalado e autenticado (`claude --version`)
- Conta WhatsApp ativa num telemóvel (para parear via QR uma vez)

## Setup inicial

```bat
REM 1. Instalar dependências do scraper e dos scripts
cd scraper
npm install
cd ..\scripts
npm install
cd ..

REM 2. Autenticar WhatsApp Web (abre QR no terminal — fazer scan no telemóvel)
cd scraper
npm run auth
cd ..

REM 3. Verificar pré-requisitos
scripts\check-setup.bat

REM 4. Primeira execução manual para validar
run-now.bat
```

Após o primeiro `npm run auth`, a pasta `session\` guarda credenciais. Não precisa de fazer scan novamente excepto se o WhatsApp invalidar a sessão (raro).

## Configurar arranque automático (Task Scheduler)

1. Abrir **Task Scheduler** (Agendador de Tarefas).
2. **Create Task** (não Basic Task) com nome `WhatsAppTodo`.
3. **Triggers** → **New** → "At log on" do utilizador atual + delay de 1-2 min (rede a estabilizar).
4. **Actions** → **New** → "Start a program":
   - Program: `wscript.exe`
   - Arguments: `"<caminho-absoluto-projeto>\start_silent.vbs"`
5. **Conditions** → desmarcar "Start the task only if the computer is on AC power" se for portátil.
6. Guardar.

A partir daqui, sempre que fizeres login no Windows, a pipeline corre invisível e a UI fica disponível em http://127.0.0.1:8080. Recebes uma notificação Windows quando termina.

## Execução manual

- **`run-now.bat`** — executa a pipeline completa com output visível na consola e abre o browser.
- **Botão "Atualizar agora" na UI** — invoca `POST /api/refresh` que dispara `run-now.bat --no-pause` em background. Devolve 409 se já há execução em curso.

## Customização

### Filtrar chats no scraper — `scraper/ignore.json`

Lista de chats a ignorar (não enviados ao Claude). Suporta dois critérios:

```json
{
  "ids": ["351911111111@c.us", "120363019999999999@g.us"],
  "nameContains": ["broadcast", "spam"]
}
```

- `ids` — IDs WhatsApp completos (encontras-os em `data/conversas.txt` ou nos logs).
- `nameContains` — substrings (case-insensitive) que, se aparecerem no nome do chat, fazem-no ser ignorado.

### Ajustar o que o Claude considera tarefa — `analyzer/prompt.txt`

Contém o system prompt que define os tipos de tarefa (`promessa`, `pedido_pendente`, `compromisso`, `deadline`, `follow_up`), categorias (`Trabalho`, `Pessoal`, ...), e critérios de extração. Edita este ficheiro para mudar o comportamento — `analyzer/validate.js` valida o schema e rejeita output fora dos enums.

### Janela temporal do scraper — `scraper/scrape.js`

Por defeito busca mensagens das últimas 48h (`WINDOW_MS = 48 * 60 * 60 * 1000`). Ajusta no topo do ficheiro se quiseres mais/menos.

## UI

Servida em http://127.0.0.1:8080. Funcionalidades:

- **Lista de tarefas** com prioridade (ALTA/MÉDIA/BAIXA), categoria, prazo, pessoa origem, e excerto da mensagem original.
- **Filtros** — por prioridade, categoria, estado (pendente/concluída), texto livre.
- **Estado persistente** — marcar concluída e adicionar notas. Guardado em `data/estado.json` via `POST /api/estado`. Sobrevive a re-corridas da pipeline (associado ao ID da tarefa).
- **Tema** — auto / claro / escuro (preferência guardada no localStorage do browser).
- **Botão "Atualizar agora"** — dispara `POST /api/refresh` para correr a pipeline imediatamente em background.

## Estrutura

```
whatsapp-task-extractor/
├── start.bat              ← orquestrador silencioso (Task Scheduler)
├── start_silent.vbs       ← wrapper invisível que invoca start.bat
├── run-now.bat            ← orquestrador manual (consola visível)
├── README.md
│
├── scraper/               ← Fase 2: extração WhatsApp Web (whatsapp-web.js)
│   ├── auth.js
│   ├── scrape.js
│   └── ignore.json
│
├── analyzer/              ← Fase 3: análise com Claude Code
│   ├── analyzer.bat
│   ├── prompt.txt
│   └── validate.js
│
├── ui/                    ← Fase 4: servidor HTTP + SPA
│   ├── server.js
│   ├── app.js
│   ├── index.html
│   └── styles.css
│
├── scripts/               ← Fase 5: utilitários de orquestração
│   ├── check-setup.bat    ← verifica pré-requisitos
│   ├── notify.js          ← notificações nativas Windows (node-notifier)
│   ├── rotate-logs.bat
│   ├── rotate-logs.ps1    ← rotação de logs (>5MB) e expiração (>30d)
│   ├── health-check.bat   ← saúde do sistema (correr semanalmente)
│   ├── uninstall.bat      ← desinstalação interativa
│   └── package.json
│
├── session/               ← credenciais WhatsApp (gitignored)
├── data/                  ← outputs da pipeline (gitignored)
│   ├── conversas.txt
│   ├── todo.json
│   ├── estado.json        ← estado UI (concluídas, notas)
│   └── .lock              ← lock contra execuções concorrentes
└── logs/                  ← logs (gitignored)
    ├── start.log          ← orquestrador
    ├── scraper.log
    ├── analyzer.log
    ├── server.log
    └── ui.log
```

## Debug e troubleshooting

### Onde está o quê

| Sintoma | Onde olhar |
|---|---|
| Pipeline não correu | `logs\start.log` (último timestamp e exit code) |
| Scraper falhou | `logs\scraper.log` |
| Claude falhou | `logs\analyzer.log` |
| UI não abre | `logs\server.log`, `logs\server-stderr.log` |
| Erros no client da UI | `logs\ui.log` |

### Saúde do sistema

```bat
scripts\health-check.bat
```

Verifica sessão WhatsApp, Claude CLI, espaço em disco e se a pipeline correu na última semana. Dispara notificação em caso de aviso.

### Lock preso

Se uma execução crashou, `data\.lock` pode ficar para trás. Locks com mais de 10 min são considerados stale e ignorados automaticamente. Para forçar limpeza imediata:

```bat
del data\.lock
```

### Sessão WhatsApp expirou

Aparece notificação "Sessao WhatsApp expirou" e exit code 31. Resolve com:

```bat
cd scraper
npm run auth
```

### Claude Code com rate limit / erro

Output em `logs\analyzer.log`. Geralmente resolve esperando ou re-correndo `run-now.bat` mais tarde.

### Porto 8080 já em uso

O scraper detecta e não relança o servidor — apenas abre o browser. Se quiseres saber o PID:

```bat
netstat -ano | findstr ":8080"
```

## Exit codes do start.bat / run-now.bat

| Código | Significado |
|---:|---|
| 0  | sucesso |
| 10 | lock activo (outra execução em curso) |
| 20 | sem ligação à internet após 120s |
| 30 | scraper falhou |
| 31 | sessão WhatsApp expirou |
| 40 | analyzer falhou |
| 50 | falha a lançar UI |

## Desinstalação

```bat
scripts\uninstall.bat
```

Pede confirmação para cada passo destrutivo. Preserva `data\`, `logs\` e o código-fonte.
