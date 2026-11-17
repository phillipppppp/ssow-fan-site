/* ============================================================
   PokerTable — draws a Cigar Lounge table and its controls.

   Shared by the practice table (poker.js) and the multiplayer
   tables (poker-online.js), so both look and behave the same.
   It only ever draws a view: whatever the engine (or the server)
   says this player may see. It never decides anything itself.

   Player names come from people at multiplayer tables, so every
   name goes on the page with textContent, never as HTML.

   The deck is our own whale deck (images/cards): a big rank in the
   corner with its suit under it, whale characters on the J, Q and
   K, a whale on the Ace of Spades, a whale on the back. Sounds come
   from poker-sound.js and are triggered from here, so practice and
   multiplayer sound the same.
   ============================================================ */

(function () {
    'use strict';

    const E = window.PokerEngine;
    const SUIT = ['♠', '♥', '♦', '♣'];
    const SUIT_NAME = ['spades', 'hearts', 'diamonds', 'clubs'];
    const RANK_NAME = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'Jack', 'Queen', 'King', 'Ace'];

    function fmt(n) { return Number(n).toLocaleString(); }
    function rankText(c) { return E.RANKS[E.rankOf(c)] === 'T' ? '10' : E.RANKS[E.rankOf(c)]; }
    function cardText(c) { return rankText(c) + SUIT[E.suitOf(c)]; }

    function el(tag, cls, text) {
        const n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text !== undefined) n.textContent = text;
        return n;
    }

    /* whale art for the court cards and the Ace of Spades */
    const ART = { 9: 'jack', 10: 'queen', 11: 'king' };

    function cardEl(c, extra) {
        const n = el('span', 'Card' + (extra ? ' ' + extra : ''));
        if (c === undefined || c === null || c < 0) {
            n.classList.add('is-back');
            n.setAttribute('aria-label', 'face-down card');
            return n;
        }
        const r = E.rankOf(c);
        const s = E.suitOf(c);
        if (s === 1 || s === 2) n.classList.add('is-red');
        if (r === 8) n.classList.add('is-ten');
        n.setAttribute('aria-label', RANK_NAME[r] + ' of ' + SUIT_NAME[s]);
        const corner = el('span', 'Card-corner');
        corner.appendChild(el('span', 'Card-rank', rankText(c)));
        corner.appendChild(el('span', 'Card-pip', SUIT[s]));
        n.appendChild(corner);
        const art = ART[r] || (r === 12 && s === 0 ? 'ace-spades' : null);
        if (art) {
            n.classList.add('is-art');
            const a = el('span', 'Card-art Card-art--' + art);
            n.appendChild(a);
        } else {
            n.appendChild(el('span', 'Card-suit', SUIT[s]));
        }
        return n;
    }

    function create(els) {
        let who = [];                 /* per seat: { name, img, bg, style, you } */
        let me = -1;                  /* the seat this browser plays, -1 = watching */
        let posOf = function (s) { return s; };
        let shownBoard = 0;
        let timerKey = '';
        let onAct = null;
        let timerNow = null;          /* the running turn clock, for the last-5-seconds ticks */
        let lastTick = 0;
        let lastTurn = '';
        let hushUntil = 0;            /* no sounds while a joined table catches up */

        function sound(name, delay) {
            if (Date.now() < hushUntil || !window.LoungeSound) return;
            window.LoungeSound.play(name, delay);
        }

        /* ---------- seats ---------- */

        function setPlayers(list, mySeat, positions) {
            who = list;
            me = mySeat;
            posOf = positions || function (s) { return s; };
            els.table.querySelectorAll('.Seat, .Bet, .Dealer').forEach(function (n) { n.remove(); });
            for (let s = 0; s < E.SEATS; s++) {
                const w = who[s];
                if (!w) continue;
                const pos = posOf(s);

                const seat = el('div', 'Seat' + (s === me ? ' Seat--you' : ''));
                seat.dataset.pos = pos;
                seat.id = 'seat' + s;
                seat.appendChild(el('div', 'Seat-cards'));
                const avatar = el('div', 'Seat-avatar' + (w.logo ? ' is-logo' : ''));
                avatar.style.setProperty('--seat-bg', w.bg || '#fffaf1');
                const img = el('img');
                img.alt = '';
                img.width = 160;
                img.height = 160;
                img.src = w.img;
                avatar.appendChild(img);
                seat.appendChild(avatar);
                const plate = el('div', 'Seat-plate');
                plate.appendChild(el('span', 'Seat-name', w.name));
                if (w.style) plate.appendChild(el('span', 'Seat-style', w.style));
                plate.appendChild(el('span', 'Seat-stack'));
                seat.appendChild(plate);
                const timer = el('span', 'Seat-timer');
                timer.appendChild(el('span'));
                seat.appendChild(timer);
                const tag = el('span', 'Seat-tag');
                tag.hidden = true;
                seat.appendChild(tag);
                els.table.appendChild(seat);

                const bet = el('div', 'Bet');
                bet.dataset.pos = pos;
                bet.id = 'bet' + s;
                bet.hidden = true;
                els.table.appendChild(bet);
            }
            const dealer = el('span', 'Dealer', 'D');
            dealer.id = 'dealer';
            dealer.setAttribute('aria-label', 'dealer button');
            dealer.hidden = true;
            els.table.appendChild(dealer);
            shownBoard = 0;
        }

        /* change one seat's picture later (a custom whale arriving from IPFS) */
        function setImage(s, src, bg) {
            const img = document.querySelector('#seat' + s + ' .Seat-avatar img');
            if (img) img.src = src;
            const av = document.querySelector('#seat' + s + ' .Seat-avatar');
            if (av && bg) av.style.setProperty('--seat-bg', bg);
        }

        /* ---------- drawing ---------- */

        /* v: a view (engine.view or the server's public table, with this
           player's own cards merged in). opts: { newHand, away: [bool],
           sittingOut: [bool], timer: { seat, endsAt, total } } */
        function render(v, opts) {
            opts = opts || {};
            const h = v.hand;
            const result = h && h.result;
            const newHand = !!opts.newHand;

            for (let s = 0; s < E.SEATS; s++) {
                if (!who[s]) continue;
                const seat = document.getElementById('seat' + s);
                const p = v.seats[s];
                if (!seat || !p) continue;
                const dealt = !!(h && h.dealt[s]);
                seat.classList.toggle('is-out', !!p.out);
                seat.classList.toggle('is-folded', !!(dealt && h.folded[s]));
                seat.classList.toggle('is-turn', !!(h && !result && h.toAct === s));
                seat.classList.toggle('is-winner', !!(result && result.won[s] > 0));
                seat.classList.toggle('is-away', !!(opts.away && opts.away[s]));
                seat.classList.toggle('is-sitting', !!(opts.sittingOut && opts.sittingOut[s]));
                seat.querySelector('.Seat-stack').textContent = p.out ? 'out · #' + p.place : fmt(p.stack);

                const cards = seat.querySelector('.Seat-cards');
                const holes = dealt ? h.holes[s] : null;
                const showCards = dealt && !(h.folded[s] && s !== me);
                const key = showCards ? (h.no + ':' + holes.join(',') + (h.folded[s] ? ':f' : '')) : '';
                if (newHand || cards.dataset.key !== key) {
                    const flip = !newHand && cards.dataset.key && key.indexOf('-1') < 0 && cards.dataset.key.indexOf('-1') >= 0;
                    if (flip) sound('flip', 0.05 * s);
                    cards.innerHTML = '';
                    cards.dataset.key = key;
                    if (showCards) {
                        holes.forEach(function (c, i) {
                            const n = cardEl(c, newHand ? 'is-dealt' : (flip ? 'is-flip' : ''));
                            n.style.setProperty('--i', i + s * 0.3);
                            if (h.folded[s]) n.classList.add('is-mucked');
                            cards.appendChild(n);
                        });
                    }
                }
                if (newHand) seat.querySelector('.Seat-tag').hidden = true;

                const bet = document.getElementById('bet' + s);
                const amount = h && !result ? h.bets[s] : 0;
                bet.hidden = !amount;
                if (amount) bet.textContent = fmt(amount);
            }

            const dealer = document.getElementById('dealer');
            if (dealer) {
                dealer.hidden = v.button < 0 || !who[v.button];
                if (v.button >= 0) dealer.dataset.pos = posOf(v.button);
            }

            if (newHand && h) {
                sound('shuffle');
                const cardsOut = Math.min(12, h.dealt.filter(Boolean).length * 2);
                for (let i = 0; i < cardsOut; i++) sound('deal', 0.62 + i * 0.09);
            }

            /* board: only new cards flip in */
            const board = h ? h.board : [];
            if (!newHand && board.length > shownBoard) {
                for (let i = shownBoard; i < board.length; i++) sound('flip', (i - shownBoard) * 0.14);
            }
            if (newHand || board.length < shownBoard) { els.board.innerHTML = ''; shownBoard = 0; }
            for (let i = shownBoard; i < 5; i++) {
                if (i < board.length) {
                    const n = cardEl(board[i], 'is-flip');
                    n.style.setProperty('--i', i - shownBoard);
                    const slot = els.board.children[i];
                    if (slot) els.board.replaceChild(n, slot); else els.board.appendChild(n);
                } else if (!els.board.children[i]) {
                    els.board.appendChild(el('span', 'Card is-slot'));
                }
            }
            shownBoard = board.length;

            els.pot.textContent = 'Pot ' + fmt(E.pot(v));
            renderTimer(opts.timer);
        }

        /* the shrinking bar under whoever is acting */
        function renderTimer(t) {
            timerNow = t || null;
            const key = t ? t.seat + ':' + t.endsAt : '';
            if (key === timerKey) return;
            timerKey = key;
            document.querySelectorAll('.Seat.has-timer').forEach(function (n) { n.classList.remove('has-timer'); });
            if (!t) return;
            const seat = document.getElementById('seat' + t.seat);
            if (!seat) return;
            const bar = seat.querySelector('.Seat-timer span');
            const left = Math.max(0, t.endsAt - Date.now());
            bar.style.animation = 'none';
            void bar.offsetWidth;
            bar.style.setProperty('--from', Math.min(1, left / t.total));
            bar.style.animation = 'seatTimer ' + left + 'ms linear forwards';
            seat.classList.add('has-timer');
        }

        /* ---------- your controls ---------- */

        function controls(v) {
            const h = v.hand;
            const L = h && !h.result && h.toAct === me ? E.legal(v, me) : null;
            els.actions.hidden = !L;
            if (!L) return false;
            const toCall = L.toCall;
            status(toCall ? 'Your turn — ' + fmt(toCall) + ' to call' : 'Your turn');
            els.fold.hidden = L.canCheck;
            els.call.textContent = L.canCheck ? 'Check' : 'Call ' + fmt(toCall) + (toCall >= v.seats[me].stack ? ' (all-in)' : '');
            els.raise.hidden = !L.raise;
            els.raiseBox.hidden = !L.raise;
            if (L.raise) {
                els.raiseRange.min = L.raise.min;
                els.raiseRange.max = L.raise.max;
                els.raiseRange.step = 1;
                els.raiseRange.value = L.raise.min;
            }
            current = v;
            raiseLabel();
            els.call.focus({ preventScroll: true });
            const turnKey = h.no + ':' + h.log.length;
            if (turnKey !== lastTurn) { lastTurn = turnKey; sound('turn'); }
            return true;
        }

        let current = null;          /* the view the buttons were drawn for */

        function legalNow() { return current && current.hand && !current.hand.result ? E.legal(current, me) : null; }

        /* the slider moves a chip at a time so its ends are reachable;
           in between, amounts round to the small blind */
        function raiseTo() {
            const L = legalNow();
            if (!L || !L.raise) return null;
            const v = Number(els.raiseRange.value);
            if (v >= L.raise.max) return L.raise.max;
            if (v <= L.raise.min) return L.raise.min;
            const unit = Math.max(1, current.hand.blinds[0]);
            return Math.min(L.raise.max, Math.max(L.raise.min, Math.round(v / unit) * unit));
        }

        function raiseLabel() {
            const L = legalNow();
            if (!L || !L.raise) return;
            const to = raiseTo();
            const word = current.hand.currentBet === 0 ? 'Bet ' : 'Raise to ';
            els.raise.textContent = to >= L.raise.max ? 'All-in ' + fmt(L.raise.max) : word + fmt(to);
        }

        function preset(size) {
            const L = legalNow();
            if (!L || !L.raise) return;
            const h = current.hand;
            const pot = E.pot(current) + L.toCall;
            let to = L.raise.min;
            if (size === 'half') to = h.currentBet + Math.round(pot / 2);
            else if (size === 'pot') to = h.currentBet + pot;
            else if (size === 'all') to = L.raise.max;
            els.raiseRange.value = Math.min(L.raise.max, Math.max(L.raise.min, to));
            raiseLabel();
        }

        function send(action) {
            if (!onAct || els.actions.hidden) return;
            els.actions.hidden = true;
            onAct(action);
        }

        els.fold.addEventListener('click', function () { send({ type: 'fold' }); });
        els.call.addEventListener('click', function () {
            const L = legalNow();
            if (L) send(L.canCheck ? { type: 'check' } : { type: 'call' });
        });
        els.raise.addEventListener('click', function () {
            const to = raiseTo();
            if (to) send({ type: 'raise', to: to });
        });
        els.raiseRange.addEventListener('input', raiseLabel);
        document.querySelectorAll('.Raise-presets button').forEach(function (b) {
            b.addEventListener('click', function () { preset(b.dataset.size); });
        });
        document.addEventListener('keydown', function (e) {
            if (els.actions.hidden || e.ctrlKey || e.metaKey || e.altKey) return;
            if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName) && e.target !== els.raiseRange) return;
            const k = e.key.toLowerCase();
            if (k === 'f' && !els.fold.hidden) { e.preventDefault(); els.fold.click(); }
            else if (k === 'c') { e.preventDefault(); els.call.click(); }
            else if (k === 'r' && !els.raise.hidden) { e.preventDefault(); els.raise.click(); }
        });

        /* the last five seconds of YOUR clock tick */
        setInterval(function () {
            const t = timerNow;
            if (!t || t.seat !== me || els.actions.hidden) return;
            const left = t.endsAt - Date.now();
            const sec = Math.ceil(left / 1000);
            if (left > 0 && sec <= 5 && sec !== lastTick) { lastTick = sec; sound('tick'); }
            if (sec > 5) lastTick = 0;
        }, 200);

        /* the speaker button on the table */
        const mute = document.getElementById('loungeMute');
        function showMute(m) {
            if (!mute) return;
            mute.setAttribute('aria-pressed', m ? 'true' : 'false');
            mute.setAttribute('aria-label', m ? 'Sound off — turn it on' : 'Sound on — mute');
            mute.title = m ? 'Sound off' : 'Sound on';
            mute.textContent = m ? '🔇' : '🔊';
        }
        if (mute && window.LoungeSound) {
            showMute(window.LoungeSound.isMuted());
            mute.addEventListener('click', function () { showMute(window.LoungeSound.toggle()); });
        }

        /* full screen: the browser's own where it exists (desktop, Android),
           otherwise the table just fills the page (iPhone Safari) */
        const fullBtn = document.getElementById('loungeFull');
        const lounge = document.getElementById('lounge');
        function setFull(on) {
            if (!lounge || !fullBtn) return;
            lounge.classList.toggle('is-full', on);
            document.documentElement.classList.toggle('lounge-full', on);
            fullBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
            fullBtn.setAttribute('aria-label', on ? 'Leave full screen' : 'Full screen');
            fullBtn.title = on ? 'Leave full screen (Esc)' : 'Full screen';
        }
        if (fullBtn && lounge) {
            fullBtn.addEventListener('click', function () {
                const on = !lounge.classList.contains('is-full');
                setFull(on);
                try {
                    if (on && lounge.requestFullscreen && !document.fullscreenElement) lounge.requestFullscreen().catch(function () { /* page-filling is enough */ });
                    if (!on && document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(function () {});
                } catch (e) { /* page-filling is enough */ }
            });
            /* Esc (or the browser's own button) leaves full screen */
            document.addEventListener('fullscreenchange', function () {
                if (!document.fullscreenElement && lounge.classList.contains('is-full')) setFull(false);
            });
            document.addEventListener('keydown', function (e) {
                if (e.key !== 'Escape' || !lounge.classList.contains('is-full')) return;
                setFull(false);
                if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(function () {});
            });
            /* back in the lobby: out of full screen */
            document.addEventListener('lounge:mode', function (e) {
                if (e.detail === 'lobby' && lounge.classList.contains('is-full')) {
                    setFull(false);
                    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(function () {});
                }
            });
        }

        /* ---------- words ---------- */

        function status(text) { els.status.textContent = text; }
        function blinds(text) { els.blinds.textContent = text; }
        function say(text) { els.say.textContent = text || ''; }

        function log(text, cls) {
            const li = el('li', cls || '', text);
            els.log.prepend(li);
            while (els.log.children.length > 60) els.log.lastChild.remove();
        }

        function clearLog() { els.log.innerHTML = ''; }

        function nameOf(s) { return who[s] ? (s === me ? 'You' : who[s].name) : 'Seat ' + (s + 1); }

        /* "Whale #2469 raises to 120" — and the tag over the seat */
        function entry(e) {
            if (e.type === 'flop' || e.type === 'turn' || e.type === 'river') {
                log(e.type[0].toUpperCase() + e.type.slice(1) + ': ' + e.cards.map(cardText).join(' '), 'is-street');
                return;
            }
            if (e.type === 'sb' || e.type === 'bb') return;
            const you = e.seat === me;
            const verb = function (base) { return you ? base : base + 's'; };
            const allIn = e.allIn ? ' (all-in)' : '';
            const auto = e.auto ? ' (time ran out)' : '';
            let what = '';
            if (e.type === 'fold') what = verb('fold');
            else if (e.type === 'check') what = verb('check');
            else if (e.type === 'call') what = verb('call') + ' ' + fmt(e.amount) + allIn;
            else if (e.type === 'bet') what = verb('bet') + ' ' + fmt(e.to) + allIn;
            else if (e.type === 'raise') what = verb('raise') + ' to ' + fmt(e.to) + allIn;
            if (!what) return;
            log(nameOf(e.seat) + ' ' + what + auto);
            flash(e.seat, what);
            sound(e.allIn ? 'allin' : e.type);
        }

        function flash(s, text) {
            const tag = document.querySelector('#seat' + s + ' .Seat-tag');
            if (!tag) return;
            tag.textContent = text;
            tag.hidden = false;
            tag.classList.remove('is-pop');
            void tag.offsetWidth;
            tag.classList.add('is-pop');
        }

        /* log the winners and shown hands; returns the headline */
        function result(v) {
            const h = v.hand;
            const r = h.result;
            const lines = r.pots.map(function (pot, i) {
                const names = pot.winners.map(nameOf).join(' & ');
                const label = r.pots.length > 1 ? (i === 0 ? 'main pot ' : 'side pot ') : '';
                const hand = r.showdown ? ' with ' + r.hands[pot.winners[0]] : '';
                const verb = pot.winners.length > 1 ? ' split ' : (pot.winners[0] === me ? ' win ' : ' wins ');
                return names + verb + label + fmt(pot.amount) + hand;
            });
            lines.forEach(function (l) { log(l, 'is-win'); });
            r.shown.forEach(function (s) {
                if (s !== me && r.hands[s] && h.holes[s] && h.holes[s][0] >= 0) {
                    log(nameOf(s) + ' shows ' + h.holes[s].map(cardText).join(' ') + ' — ' + r.hands[s]);
                }
            });
            for (let s = 0; s < E.SEATS; s++) if (r.won[s]) flash(s, '+' + fmt(r.won[s]));
            sound('push', r.showdown ? 0.5 : 0.15);
            say(lines[0] || '');
            return lines[0] || '';
        }

        return {
            setPlayers: setPlayers,
            setImage: setImage,
            render: render,
            controls: controls,
            hideControls: function () { els.actions.hidden = true; },
            onAct: function (fn) { onAct = fn; },
            status: status,
            blinds: blinds,
            say: say,
            log: log,
            clearLog: clearLog,
            entry: entry,
            result: result,
            flash: flash,
            nameOf: nameOf,
            hush: function (ms) { hushUntil = Date.now() + ms; },
            sound: sound
        };
    }

    /* One table on the page: practice and online share it, and whichever
       is playing sets onAct. Two copies would both grab the buttons. */
    let shared = null;
    function get(els) { return shared || (shared = create(els)); }

    window.PokerTable = { get: get, fmt: fmt, cardText: cardText, card: cardEl };
})();
