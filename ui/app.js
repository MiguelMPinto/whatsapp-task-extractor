'use strict';

(function() {
    const PREFS_KEY = 'wt:prefs:v1';

    const state = {
        tarefas: [],
        meta: null,
        estado: { tarefas_concluidas: {}, notas: {}, overrides: {} },
        filtros: {
            prioridade: 'todas',
            categoria: null,
            pessoa: null,
            pesquisa: '',
            mostrarConcluidas: false
        },
        ordenacao: 'prioridade',
        tema: 'auto',
        ultimaAtualizacao: null,
        seleccionadaId: null
    };

    // ---- Utilidades ----
    function $(sel, root) { return (root || document).querySelector(sel); }
    function $$(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

    function debounce(fn, delay) {
        let t;
        return function(...args) {
            clearTimeout(t);
            t = setTimeout(() => fn.apply(this, args), delay);
        };
    }

    function isoNow() { return new Date().toISOString(); }

    function logBackend(level, msg, stack) {
        try {
            fetch('/api/logs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ level, msg, stack: stack || '' })
            }).catch(() => {});
        } catch (_) {}
    }

    window.addEventListener('error', (e) => {
        logBackend('error', e.message || 'erro desconhecido', e.error && e.error.stack);
    });
    window.addEventListener('unhandledrejection', (e) => {
        const r = e.reason;
        const msg = (r && r.message) || String(r);
        logBackend('error', 'unhandled rejection: ' + msg, r && r.stack);
    });

    // ---- Preferências (localStorage) ----
    function carregarPrefs() {
        try {
            const raw = localStorage.getItem(PREFS_KEY);
            if (!raw) return;
            const p = JSON.parse(raw);
            if (p.filtros) Object.assign(state.filtros, p.filtros);
            if (p.ordenacao) state.ordenacao = p.ordenacao;
            if (p.tema) state.tema = p.tema;
        } catch (_) {}
    }
    const guardarPrefs = debounce(() => {
        try {
            localStorage.setItem(PREFS_KEY, JSON.stringify({
                filtros: state.filtros,
                ordenacao: state.ordenacao,
                tema: state.tema
            }));
        } catch (_) {}
    }, 200);

    // ---- Tema ----
    function aplicarTema() {
        let dark;
        if (state.tema === 'escuro') dark = true;
        else if (state.tema === 'claro') dark = false;
        else dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        document.documentElement.classList.toggle('dark', !!dark);
        const icone = $('#icone-tema');
        if (icone) {
            icone.textContent = state.tema === 'auto' ? '🌓' : (state.tema === 'claro' ? '☀️' : '🌙');
            const btn = icone.parentElement;
            if (btn) btn.title = `Tema: ${state.tema} (clica para alternar)`;
        }
    }
    function alternarTema() {
        state.tema = state.tema === 'auto' ? 'claro' : (state.tema === 'claro' ? 'escuro' : 'auto');
        aplicarTema();
        guardarPrefs();
    }
    if (window.matchMedia) {
        const mq = window.matchMedia('(prefers-color-scheme: dark)');
        if (mq.addEventListener) {
            mq.addEventListener('change', () => { if (state.tema === 'auto') aplicarTema(); });
        }
    }

    // ---- Carregamento ----
    async function carregarDados() {
        mostrarEstado('carregar');
        try {
            const [todosRes, estadoRes] = await Promise.all([
                fetch('/api/todos'),
                fetch('/api/estado')
            ]);
            if (!todosRes.ok) throw new Error('todos: ' + todosRes.status);
            if (!estadoRes.ok) throw new Error('estado: ' + estadoRes.status);
            const todos = await todosRes.json();
            const estado = await estadoRes.json();

            // Caso "ficheiro nao existe": servidor devolve [] vazio
            if (Array.isArray(todos)) {
                state.tarefas = [];
                state.meta = null;
                state.ultimaAtualizacao = null;
                actualizarMetaUI();
                mostrarEstado('primeiro-uso');
                return;
            }

            state.tarefas = Array.isArray(todos.tarefas) ? todos.tarefas : [];
            state.meta = {
                data_geracao: todos.data_geracao,
                total_conversas_analisadas: todos.total_conversas_analisadas,
                total_mensagens_processadas: todos.total_mensagens_processadas
            };
            state.estado = {
                tarefas_concluidas: (estado && estado.tarefas_concluidas) || {},
                notas: (estado && estado.notas) || {},
                overrides: (estado && estado.overrides) || {}
            };
            state.ultimaAtualizacao = todos.data_geracao || null;
            actualizarMetaUI();
            renderizar();
        } catch (e) {
            logBackend('error', 'falha a carregar: ' + e.message);
            mostrarEstado('erro', e.message);
        }
    }

    function mostrarEstado(tipo, msg) {
        $$('.estado').forEach((el) => el.hidden = true);
        const lista = $('#lista');
        if (tipo) {
            lista.innerHTML = '';
            const el = $('#estado-' + tipo);
            if (el) {
                el.hidden = false;
                if (tipo === 'erro' && msg) {
                    const p = $('#estado-erro-msg');
                    if (p) p.textContent = 'Não foi possível carregar as tarefas. (' + msg + ')';
                }
            }
        }
    }
    function esconderEstados() {
        $$('.estado').forEach((el) => el.hidden = true);
    }

    function actualizarMetaUI() {
        const contador = $('#contador');
        const ultima = $('#ultima-atualizacao');
        if (!state.tarefas.length) {
            contador.textContent = 'sem tarefas';
        } else {
            const concluidas = Object.keys(state.estado.tarefas_concluidas).length;
            const pendentes = state.tarefas.filter(t => !state.estado.tarefas_concluidas[t.id]).length;
            contador.textContent = `${pendentes} pendente${pendentes === 1 ? '' : 's'}` +
                (concluidas ? ` · ${concluidas} concluída${concluidas === 1 ? '' : 's'}` : '');
        }
        if (state.ultimaAtualizacao) {
            ultima.textContent = 'Actualizado ' + tempoRelativo(state.ultimaAtualizacao);
            ultima.title = state.ultimaAtualizacao;
        } else {
            ultima.textContent = '—';
        }
    }

    function tempoRelativo(iso) {
        const d = new Date(iso);
        if (isNaN(d.getTime())) return iso;
        const diff = (Date.now() - d.getTime()) / 1000;
        if (diff < 60) return 'agora mesmo';
        if (diff < 3600) return `há ${Math.floor(diff / 60)}min`;
        if (diff < 86400) return `há ${Math.floor(diff / 3600)}h`;
        return `há ${Math.floor(diff / 86400)}d`;
    }

    // ---- Filtros e ordenação ----
    const PRI_ORDEM = { ALTA: 0, MEDIA: 1, BAIXA: 2 };

    function obterPrioridadeEfectiva(t) {
        const ov = state.estado.overrides[t.id];
        return (ov && ov.prioridade) || t.prioridade;
    }
    function obterPrazoEfectivo(t) {
        const ov = state.estado.overrides[t.id];
        if (ov && Object.prototype.hasOwnProperty.call(ov, 'prazo')) return ov.prazo;
        return t.prazo;
    }

    function aplicarFiltros(tarefas) {
        const f = state.filtros;
        const q = (f.pesquisa || '').toLowerCase().trim();
        return tarefas.filter((t) => {
            const concluida = !!state.estado.tarefas_concluidas[t.id];
            if (!f.mostrarConcluidas && concluida) return false;
            if (f.prioridade !== 'todas' && obterPrioridadeEfectiva(t) !== f.prioridade) return false;
            if (f.categoria && t.categoria !== f.categoria) return false;
            if (f.pessoa && t.pessoa !== f.pessoa) return false;
            if (q) {
                const blob = `${t.titulo || ''} ${t.descricao || ''} ${t.pessoa || ''} ${t.conversa_origem || ''}`.toLowerCase();
                if (!blob.includes(q)) return false;
            }
            return true;
        });
    }

    function ordenar(tarefas) {
        const arr = tarefas.slice();
        switch (state.ordenacao) {
            case 'prazo':
                arr.sort((a, b) => {
                    const pa = obterPrazoEfectivo(a) || '9999-12-31';
                    const pb = obterPrazoEfectivo(b) || '9999-12-31';
                    if (pa !== pb) return pa < pb ? -1 : 1;
                    return PRI_ORDEM[obterPrioridadeEfectiva(a)] - PRI_ORDEM[obterPrioridadeEfectiva(b)];
                });
                break;
            case 'categoria':
                arr.sort((a, b) => (a.categoria || '').localeCompare(b.categoria || '', 'pt'));
                break;
            case 'confianca':
                arr.sort((a, b) => (b.confianca || 0) - (a.confianca || 0));
                break;
            case 'prioridade':
            default:
                arr.sort((a, b) => {
                    const dp = PRI_ORDEM[obterPrioridadeEfectiva(a)] - PRI_ORDEM[obterPrioridadeEfectiva(b)];
                    if (dp !== 0) return dp;
                    const pa = obterPrazoEfectivo(a) || '9999-12-31';
                    const pb = obterPrazoEfectivo(b) || '9999-12-31';
                    return pa < pb ? -1 : (pa > pb ? 1 : 0);
                });
        }
        return arr;
    }

    function agrupar(tarefas) {
        const grupos = new Map();
        let chave;
        tarefas.forEach((t) => {
            switch (state.ordenacao) {
                case 'categoria': chave = t.categoria || 'Outras'; break;
                case 'prazo': chave = obterPrazoEfectivo(t) || 'sem-prazo'; break;
                case 'confianca':
                    {
                        const c = t.confianca || 0;
                        chave = c >= 80 ? 'alta-confianca' : (c >= 50 ? 'media-confianca' : 'baixa-confianca');
                    }
                    break;
                default: chave = obterPrioridadeEfectiva(t);
            }
            if (!grupos.has(chave)) grupos.set(chave, []);
            grupos.get(chave).push(t);
        });
        return grupos;
    }

    function rotuloGrupo(chave) {
        if (chave === 'ALTA') return '🔴 Prioridade alta';
        if (chave === 'MEDIA') return '🟠 Prioridade média';
        if (chave === 'BAIXA') return '🟢 Prioridade baixa';
        if (chave === 'sem-prazo') return 'Sem prazo';
        if (chave === 'alta-confianca') return 'Confiança alta (≥80%)';
        if (chave === 'media-confianca') return 'Confiança média (50-79%)';
        if (chave === 'baixa-confianca') return 'Confiança baixa (<50%)';
        if (/^\d{4}-\d{2}-\d{2}$/.test(chave)) return formatarData(chave);
        return chave;
    }

    function formatarData(iso) {
        if (!iso) return '';
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
        if (!m) return iso;
        const meses = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
        return `${parseInt(m[3], 10)} ${meses[parseInt(m[2], 10) - 1]} ${m[1]}`;
    }

    // ---- Renderização ----
    function renderizar() {
        esconderEstados();
        const lista = $('#lista');

        if (state.tarefas.length === 0) {
            lista.innerHTML = '';
            mostrarEstado('primeiro-uso');
            return;
        }

        const filtradas = aplicarFiltros(state.tarefas);
        const ordenadas = ordenar(filtradas);

        actualizarMetaUI();

        if (filtradas.length === 0) {
            lista.innerHTML = '';
            mostrarEstado('vazio');
            return;
        }

        const grupos = agrupar(ordenadas);
        const tplGrupo = $('#tpl-grupo');
        const tplTarefa = $('#tpl-tarefa');

        const frag = document.createDocumentFragment();
        let stagger = 0;
        for (const [chave, tarefas] of grupos) {
            const g = tplGrupo.content.firstElementChild.cloneNode(true);
            $('.grupo-titulo', g).textContent = `${rotuloGrupo(chave)} · ${tarefas.length}`;
            const grupoLista = $('.grupo-lista', g);
            tarefas.forEach((t) => {
                const el = renderizarTarefa(t, tplTarefa);
                el.style.animationDelay = `${Math.min(stagger * 25, 400)}ms`;
                grupoLista.appendChild(el);
                stagger++;
            });
            frag.appendChild(g);
        }
        lista.innerHTML = '';
        lista.appendChild(frag);
    }

    function renderizarTarefa(t, tpl) {
        const el = tpl.content.firstElementChild.cloneNode(true);
        const concluida = !!state.estado.tarefas_concluidas[t.id];
        const prioridade = obterPrioridadeEfectiva(t);
        const prazo = obterPrazoEfectivo(t);
        const nota = state.estado.notas[t.id] || '';
        const ov = state.estado.overrides[t.id] || {};

        el.dataset.id = String(t.id);
        el.dataset.prioridade = prioridade;
        if (concluida) el.classList.add('concluida');
        if (state.seleccionadaId === t.id) el.classList.add('seleccionada');

        const cb = $('.checkbox', el);
        cb.checked = concluida;

        $('.titulo', el).textContent = t.titulo || '(sem título)';
        $('.pessoa', el).textContent = t.pessoa || '—';
        $('.conversa', el).textContent = t.conversa_origem || '';

        const prazoEl = $('.prazo', el);
        if (prazo) {
            const hora = t.hora ? ' · ' + t.hora : '';
            prazoEl.textContent = `📅 ${formatarData(prazo)}${hora}`;
            const hoje = new Date().toISOString().slice(0, 10);
            if (prazo <= hoje && !concluida) prazoEl.classList.add('urgente');
        }

        const catEl = $('.categoria', el);
        if (t.categoria) {
            catEl.textContent = t.categoria;
            catEl.dataset.cat = t.categoria;
        } else {
            catEl.remove();
        }

        $('.tipo', el).textContent = t.tipo ? t.tipo.replace(/_/g, ' ') : '';
        $('.confianca', el).textContent = (typeof t.confianca === 'number') ? `${t.confianca}%` : '';

        $('.descricao', el).textContent = t.descricao || '';
        $('.extracto', el).textContent = t.extracto_mensagem ? `"${t.extracto_mensagem}"` : '';

        $('.notas', el).value = nota;
        $('.prazo-edit', el).value = (typeof ov.prazo === 'string') ? ov.prazo : '';
        $('.prioridade-edit', el).value = ov.prioridade || '';

        // ---- Eventos ----
        cb.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleConcluida(t.id, cb.checked);
        });

        $('.tarefa-resumo', el).addEventListener('click', (e) => {
            if (e.target.closest('.checkbox')) return;
            seleccionarTarefa(t.id);
            toggleDetalhe(el);
        });

        el.addEventListener('focus', () => seleccionarTarefa(t.id, false));

        const notasEl = $('.notas', el);
        const guardarNota = debounce(() => {
            const v = notasEl.value;
            if (v) state.estado.notas[t.id] = v;
            else delete state.estado.notas[t.id];
            guardarEstado();
        }, 400);
        notasEl.addEventListener('input', guardarNota);
        notasEl.addEventListener('click', (e) => e.stopPropagation());

        const prazoEdit = $('.prazo-edit', el);
        prazoEdit.addEventListener('change', () => {
            actualizarOverride(t.id, 'prazo', prazoEdit.value || null);
            renderizar();
        });
        prazoEdit.addEventListener('click', (e) => e.stopPropagation());

        const priEdit = $('.prioridade-edit', el);
        priEdit.addEventListener('change', () => {
            actualizarOverride(t.id, 'prioridade', priEdit.value || null);
            renderizar();
        });
        priEdit.addEventListener('click', (e) => e.stopPropagation());

        return el;
    }

    function toggleDetalhe(el) {
        const det = $('.tarefa-detalhe', el);
        if (!det) return;
        const aberto = !det.hidden;
        det.hidden = aberto;
        el.classList.toggle('expandida', !aberto);
    }

    function seleccionarTarefa(id, scrollTo) {
        state.seleccionadaId = id;
        $$('.tarefa').forEach(el => {
            const match = parseInt(el.dataset.id, 10) === id;
            el.classList.toggle('seleccionada', match);
            if (match && scrollTo) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        });
    }

    function toggleConcluida(id, concluida) {
        if (concluida) {
            state.estado.tarefas_concluidas[id] = isoNow();
        } else {
            delete state.estado.tarefas_concluidas[id];
        }
        guardarEstado();

        if (concluida && !state.filtros.mostrarConcluidas) {
            const el = document.querySelector(`.tarefa[data-id="${id}"]`);
            if (el) {
                el.classList.add('removendo');
                actualizarMetaUI();
                setTimeout(() => renderizar(), 280);
                return;
            }
        }
        renderizar();
    }

    function actualizarOverride(id, campo, valor) {
        if (!state.estado.overrides[id]) state.estado.overrides[id] = {};
        if (valor === null || valor === '') {
            delete state.estado.overrides[id][campo];
        } else {
            state.estado.overrides[id][campo] = valor;
        }
        if (Object.keys(state.estado.overrides[id]).length === 0) {
            delete state.estado.overrides[id];
        }
        guardarEstado();
    }

    // ---- Persistência ----
    const guardarEstado = debounce(async () => {
        try {
            const r = await fetch('/api/estado', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(state.estado)
            });
            if (!r.ok) throw new Error('estado: ' + r.status);
        } catch (e) {
            toast('Erro a guardar estado: ' + e.message, 'erro');
            logBackend('error', 'falha a guardar estado: ' + e.message);
        }
    }, 400);

    // ---- Refresh / polling (scaffolding para Fase 5) ----
    let pollingTimer = null;
    function iniciarPolling() {
        if (pollingTimer) return;
        pollingTimer = setInterval(async () => {
            try {
                const r = await fetch('/api/todos');
                if (!r.ok) return;
                const novo = await r.json();
                if (Array.isArray(novo)) return;
                if (novo && novo.data_geracao && novo.data_geracao !== state.ultimaAtualizacao) {
                    pararPolling();
                    toast('Lista actualizada', 'sucesso');
                    notificar('✅ Lista actualizada', 'Tarefas refrescadas');
                    await carregarDados();
                }
            } catch (_) {}
        }, 10000);
    }
    function pararPolling() {
        if (pollingTimer) { clearInterval(pollingTimer); pollingTimer = null; }
    }

    async function refresh() {
        try {
            const r = await fetch('/api/refresh', { method: 'POST' });
            if (r.status === 501) {
                toast('Refresh manual estará disponível na Fase 5', 'erro');
                return;
            }
            if (!r.ok) {
                toast('Falha no refresh: ' + r.status, 'erro');
                return;
            }
            toast('Refresh iniciado, à espera...');
            iniciarPolling();
        } catch (e) {
            toast('Erro de rede no refresh', 'erro');
        }
    }

    // ---- Toasts ----
    function toast(msg, tipo) {
        const zona = $('#toast-zona');
        if (!zona) return;
        const el = document.createElement('div');
        el.className = 'toast' + (tipo ? ' ' + tipo : '');
        el.textContent = msg;
        zona.appendChild(el);
        setTimeout(() => {
            el.classList.add('saindo');
            setTimeout(() => el.remove(), 220);
        }, 3500);
    }

    // ---- Notificações do browser ----
    let permissaoPedida = false;
    function pedirPermissaoNotificacoes() {
        if (permissaoPedida) return;
        permissaoPedida = true;
        if (!('Notification' in window)) return;
        if (Notification.permission === 'default') {
            try { Notification.requestPermission().catch(() => {}); } catch (_) {}
        }
    }
    function notificar(titulo, corpo) {
        if (!('Notification' in window)) return;
        if (Notification.permission !== 'granted') return;
        try { new Notification(titulo, { body: corpo, icon: '/assets/favicon.svg' }); } catch (_) {}
    }

    // ---- Atalhos de teclado ----
    function moverSeleccao(delta) {
        const els = $$('.tarefa', $('#lista'));
        if (!els.length) return;
        let idx = els.findIndex(el => parseInt(el.dataset.id, 10) === state.seleccionadaId);
        idx = idx === -1 ? (delta > 0 ? 0 : els.length - 1)
                         : Math.max(0, Math.min(els.length - 1, idx + delta));
        const alvo = els[idx];
        const id = parseInt(alvo.dataset.id, 10);
        seleccionarTarefa(id, true);
        alvo.focus({ preventScroll: true });
    }

    function tarefaSeleccionadaEl() {
        if (state.seleccionadaId == null) return null;
        return document.querySelector(`.tarefa[data-id="${state.seleccionadaId}"]`);
    }

    function tratadorTeclado(e) {
        const overlay = $('#overlay-ajuda');
        if (overlay && !overlay.hidden) {
            if (e.key === 'Escape' || e.key === '?') { e.preventDefault(); overlay.hidden = true; }
            return;
        }

        const dentroDeInput = e.target.matches && e.target.matches('input, textarea, select');
        if (dentroDeInput) {
            if (e.key === 'Escape') e.target.blur();
            return;
        }

        switch (e.key) {
            case 'j': e.preventDefault(); moverSeleccao(1); break;
            case 'k': e.preventDefault(); moverSeleccao(-1); break;
            case 'Enter': {
                const el = tarefaSeleccionadaEl();
                if (el) { e.preventDefault(); toggleDetalhe(el); }
                break;
            }
            case ' ': {
                const el = tarefaSeleccionadaEl();
                if (el) {
                    e.preventDefault();
                    const id = parseInt(el.dataset.id, 10);
                    const concluida = !state.estado.tarefas_concluidas[id];
                    toggleConcluida(id, concluida);
                }
                break;
            }
            case 'e': {
                const el = tarefaSeleccionadaEl();
                if (el) {
                    e.preventDefault();
                    if ($('.tarefa-detalhe', el).hidden) toggleDetalhe(el);
                    const ta = $('.notas', el);
                    if (ta) ta.focus();
                }
                break;
            }
            case '/': e.preventDefault(); $('#pesquisa').focus(); break;
            case '1': e.preventDefault(); aplicarFiltroPrioridade('ALTA'); break;
            case '2': e.preventDefault(); aplicarFiltroPrioridade('MEDIA'); break;
            case '3': e.preventDefault(); aplicarFiltroPrioridade('BAIXA'); break;
            case '0': e.preventDefault(); limparFiltros(); break;
            case 'r': e.preventDefault(); refresh(); break;
            case '?': e.preventDefault(); overlay.hidden = false; break;
            case 'Escape':
                state.seleccionadaId = null;
                $$('.tarefa.seleccionada').forEach(el => el.classList.remove('seleccionada'));
                if (state.filtros.pesquisa) {
                    state.filtros.pesquisa = '';
                    $('#pesquisa').value = '';
                    renderizar();
                }
                break;
        }
    }

    function aplicarFiltroPrioridade(p) {
        state.filtros.prioridade = p;
        actualizarPillsPrioridade();
        guardarPrefs();
        renderizar();
    }
    function limparFiltros() {
        state.filtros = {
            prioridade: 'todas', categoria: null, pessoa: null,
            pesquisa: '', mostrarConcluidas: false
        };
        $('#pesquisa').value = '';
        $('#toggle-concluidas').checked = false;
        actualizarPillsPrioridade();
        guardarPrefs();
        renderizar();
    }
    function actualizarPillsPrioridade() {
        $$('.pill').forEach(p => {
            p.classList.toggle('activa', p.dataset.prioridade === state.filtros.prioridade);
        });
    }

    // ---- Ligações de UI ----
    function ligarUI() {
        $$('.pill').forEach((p) => {
            p.addEventListener('click', () => aplicarFiltroPrioridade(p.dataset.prioridade));
        });

        const pesquisa = $('#pesquisa');
        pesquisa.value = state.filtros.pesquisa;
        pesquisa.addEventListener('input', debounce(() => {
            state.filtros.pesquisa = pesquisa.value;
            guardarPrefs();
            renderizar();
        }, 200));

        const togC = $('#toggle-concluidas');
        togC.checked = state.filtros.mostrarConcluidas;
        togC.addEventListener('change', () => {
            state.filtros.mostrarConcluidas = togC.checked;
            guardarPrefs();
            renderizar();
        });

        const ord = $('#ordenacao');
        ord.value = state.ordenacao;
        ord.addEventListener('change', () => {
            state.ordenacao = ord.value;
            guardarPrefs();
            renderizar();
        });

        $('#btn-refresh').addEventListener('click', () => { pedirPermissaoNotificacoes(); refresh(); });
        $('#btn-tema').addEventListener('click', alternarTema);
        $('#btn-ajuda').addEventListener('click', () => { $('#overlay-ajuda').hidden = false; });
        $('#btn-fechar-ajuda').addEventListener('click', () => { $('#overlay-ajuda').hidden = true; });
        $('#overlay-ajuda').addEventListener('click', (e) => {
            if (e.target.id === 'overlay-ajuda') e.target.hidden = true;
        });
        $('#btn-retry').addEventListener('click', carregarDados);

        document.addEventListener('keydown', tratadorTeclado);
        document.addEventListener('click', () => pedirPermissaoNotificacoes(), { once: true });

        // Re-render do indicador "há Xmin" a cada minuto
        setInterval(actualizarMetaUI, 60000);

        actualizarPillsPrioridade();
    }

    // ---- Boot ----
    function init() {
        carregarPrefs();
        aplicarTema();
        ligarUI();
        carregarDados();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
