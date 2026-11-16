// HUD: every DOM element the player reads, updated from the game state once
// per frame, with writes skipped when nothing changed. The buy menu, the
// scoreboard, the menus and the banners all live here; the game logic only
// calls these methods and never touches the DOM itself.
import { WEAPONS, GRENADE_DEFS, EQUIPMENT, CONFIG } from './config.js';
import { TEAM_NAME } from './palette.js';
import { currentWeapon } from './actors.js';
import { createMinimap } from './minimap.js';

function el(id) {
  return document.getElementById(id);
}

function formatTime(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function createHud(callbacks) {
  const refs = {
    hud: el('hud'),
    healthFill: el('health-fill'),
    healthText: el('health-text'),
    armorFill: el('armor-fill'),
    armorText: el('armor-text'),
    moneyText: el('money-text'),
    ammoMag: el('ammo-mag'),
    ammoReserve: el('ammo-reserve'),
    weaponName: el('weapon-name'),
    grenadeRow: el('grenade-row'),
    timerText: el('timer-text'),
    timerLabel: el('timer-label'),
    scoreV: el('score-vanguard'),
    scoreA: el('score-aegis'),
    roundText: el('round-text'),
    pips: el('round-pips'),
    minimap: el('minimap'),
    bombStatus: el('bomb-status'),
    killFeed: el('kill-feed'),
    crosshair: el('crosshair'),
    hitmarker: el('hitmarker'),
    damageDir: el('damage-dir'),
    vignette: el('vignette'),
    flashOverlay: el('flash-overlay'),
    banner: el('banner'),
    bannerTitle: el('banner-title'),
    bannerSub: el('banner-sub'),
    centerMsg: el('center-msg'),
    channelBar: el('channel-bar'),
    channelFill: el('channel-fill'),
    channelLabel: el('channel-label'),
    buyMenu: el('buy-menu'),
    buyItems: el('buy-items'),
    buyMoney: el('buy-money'),
    scoreboard: el('scoreboard'),
    scoreRows: el('score-rows'),
    menu: el('menu'),
    pauseMenu: el('pause-menu'),
    endScreen: el('end-screen'),
    endTitle: el('end-title'),
    endStats: el('end-stats'),
    spectate: el('spectate'),
    hint: el('hint'),
  };

  const last = {};
  let hitmarkerUntil = 0;
  let damageUntil = 0;
  let bannerUntil = 0;
  const minimap = createMinimap(refs.minimap);

  function setText(ref, key, value) {
    if (last[key] !== value) {
      last[key] = value;
      ref.textContent = value;
    }
  }

  // --- Buy menu, built once -----------------------------------------------
  const buyEntries = [];
  function addBuyEntry(label, price, desc, buy) {
    const row = document.createElement('button');
    row.className = 'buy-item';
    row.innerHTML = '';
    const name = document.createElement('span');
    name.className = 'buy-name';
    name.textContent = label;
    const priceEl = document.createElement('span');
    priceEl.className = 'buy-price';
    priceEl.textContent = `$${price}`;
    const descEl = document.createElement('span');
    descEl.className = 'buy-desc';
    descEl.textContent = desc;
    row.append(name, priceEl, descEl);
    row.addEventListener('click', () => callbacks.onBuy(buy));
    refs.buyItems.appendChild(row);
    buyEntries.push({ row, price, buy, priceEl });
  }
  addBuyEntry('K7 Compact SMG', WEAPONS.k7.price, 'Fast, close range. 30 rounds.', { kind: 'weapon', id: 'k7' });
  addBuyEntry('M870 Breacher', WEAPONS.m870.price, 'Shotgun. Devastating up close.', { kind: 'weapon', id: 'm870' });
  addBuyEntry('AR-4 Assault Rifle', WEAPONS.ar4.price, 'The workhorse. Accurate in bursts.', { kind: 'weapon', id: 'ar4' });
  addBuyEntry('DMR-7 Marksman', WEAPONS.dmr7.price, 'Semi-auto precision. Right-click to zoom.', { kind: 'weapon', id: 'dmr7' });
  addBuyEntry('Kevlar Vest', EQUIPMENT.armor.price, 'Halves bullet damage until it breaks.', { kind: 'armor' });
  addBuyEntry('Defuse Kit', EQUIPMENT.kit.price, 'Halves defuse time. (Defenders use it.)', { kind: 'kit' });
  addBuyEntry('Frag Charge', GRENADE_DEFS.frag.price, 'Explodes after 2.5s. Key 4, throw with G.', { kind: 'grenade', id: 'frag' });
  addBuyEntry('Flash Charge', GRENADE_DEFS.flash.price, 'Blinds anyone looking at it. Key 5.', { kind: 'grenade', id: 'flash' });
  addBuyEntry('Smoke Charge', GRENADE_DEFS.smoke.price, 'Blocks sight for 13s. Key 6.', { kind: 'grenade', id: 'smoke' });

  // --- Kill feed -----------------------------------------------------------
  function addKill(killer, victim, headshot, exploded) {
    const row = document.createElement('div');
    row.className = 'kill-row';
    const k = document.createElement('span');
    k.className = `kill-name ${killer ? killer.team : ''}`;
    k.textContent = killer ? killer.name : '—';
    const mid = document.createElement('span');
    mid.className = 'kill-mid';
    mid.textContent = exploded ? '💥' : headshot ? '◎' : '▸';
    const v = document.createElement('span');
    v.className = `kill-name ${victim.team}`;
    v.textContent = victim.name;
    row.append(k, mid, v);
    refs.killFeed.prepend(row);
    while (refs.killFeed.children.length > 5) refs.killFeed.lastChild.remove();
    setTimeout(() => row.remove(), 6000);
  }

  function showBanner(title, sub, cls, seconds) {
    refs.bannerTitle.textContent = title;
    refs.bannerSub.textContent = sub || '';
    refs.banner.className = `show ${cls || ''}`;
    bannerUntil = performance.now() / 1000 + (seconds || 3.5);
  }

  function update(state, player, dt, now) {
    const bomb = state.bomb;
    // Health and armour.
    const hp = Math.max(0, player.health);
    setText(refs.healthText, 'hp', String(hp));
    refs.healthFill.style.width = `${hp}%`;
    refs.healthFill.style.background = hp > 50 ? '#e8e2d4' : hp > 25 ? '#f0a832' : '#d94a3a';
    setText(refs.armorText, 'armor', String(Math.round(player.armor)));
    refs.armorFill.style.width = `${Math.min(100, player.armor)}%`;
    setText(refs.moneyText, 'money', `$${player.money}`);
    // Weapon.
    const weapon = currentWeapon(player.loadout);
    setText(refs.ammoMag, 'mag', String(weapon.mag));
    setText(refs.ammoReserve, 'reserve', String(weapon.reserve));
    setText(refs.weaponName, 'wname', weapon.def.name);
    const grenades = player.loadout.grenades;
    const sel = player.loadout.selectedGrenade;
    setText(refs.grenadeRow, 'grenades', `Frag ${grenades.frag} · Flash ${grenades.flash} · Smoke ${grenades.smoke} — selected: ${sel.toUpperCase()}`);
    // Timer and score.
    const timerValue = state.phase === 'freeze' ? state.freezeLeft
      : bomb.state === 'planted' ? bomb.fuseLeft
        : state.phase === 'live' ? state.roundLeft
          : state.roundLeft;
    setText(refs.timerText, 'timer', formatTime(timerValue));
    setText(refs.timerLabel, 'timerLabel', state.phase === 'freeze' ? 'BUY PHASE' : bomb.state === 'planted' ? 'CHARGE FUSE' : 'ROUND');
    refs.timerText.style.color = bomb.state === 'planted' || (state.phase === 'live' && state.roundLeft < 15) ? '#ff6a55' : '#e8e2d4';
    setText(refs.scoreV, 'scoreV', String(state.scores.vanguard));
    setText(refs.scoreA, 'scoreA', String(state.scores.aegis));
    setText(refs.roundText, 'round', `ROUND ${Math.min(state.round, CONFIG.match.maxRounds)} / ${CONFIG.match.maxRounds}`);
    // Round-history pips: one dot per finished round, in team colours.
    if (last.pips !== state.roundHistory.length) {
      last.pips = state.roundHistory.length;
      refs.pips.innerHTML = '';
      for (const r of state.roundHistory) {
        const pip = document.createElement('span');
        pip.className = `pip ${r === 'V' ? 'v' : 'a'}`;
        refs.pips.appendChild(pip);
      }
    }
    minimap.draw(state, !player.alive && state.spectateTarget ? state.spectateTarget : player);
    setText(refs.bombStatus, 'bomb', bomb.state === 'planted' ? `● CHARGE PLANTED — SITE ${bomb.site}`
      : bomb.state === 'dropped' ? '● CHARGE DROPPED'
        : bomb.carrier ? `● CHARGE: ${bomb.carrier.name}` : '● CHARGE READY');
    // Crosshair gap grows with spread.
    const spread = state.playerSpread || 0;
    refs.crosshair.style.setProperty('--gap', `${4 + spread * 260}px`);
    refs.crosshair.style.opacity = player.alive && state.phase === 'live' ? '1' : '0.25';
    // Hitmarker and damage direction fade.
    refs.hitmarker.style.opacity = now < hitmarkerUntil ? '1' : '0';
    refs.damageDir.style.opacity = now < damageUntil ? '1' : '0';
    refs.vignette.style.opacity = player.alive ? String(Math.max(0, (30 - hp) / 30) * 0.6) : '0';
    refs.flashOverlay.style.opacity = String(Math.min(1, player.blind));
    if (bannerUntil && now > bannerUntil) {
      refs.banner.className = '';
      bannerUntil = 0;
    }
    // Channel progress (plant / defuse).
    if (state.channel && state.channel.active) {
      refs.channelBar.style.display = 'block';
      refs.channelLabel.textContent = state.channel.label;
      refs.channelFill.style.width = `${Math.round(state.channel.progress * 100)}%`;
    } else {
      refs.channelBar.style.display = 'none';
    }
    // Spectate label.
    if (!player.alive && state.phase === 'live' && state.spectateTarget) {
      refs.spectate.style.display = 'block';
      setText(refs.spectate, 'spec', `SPECTATING ${state.spectateTarget.name} — round ends soon`);
    } else {
      refs.spectate.style.display = 'none';
    }
    void dt;
  }

  function renderBuy(player, canBuy) {
    setText(refs.buyMoney, 'buyMoney', `$${player.money}`);
    for (const entry of buyEntries) {
      // Owned or full rows say so instead of inviting a useless click: the
      // buy rules refuse them, so the menu shows the same answer up front.
      const owned = entry.buy.kind === 'weapon' ? player.loadout.primary?.def.id === entry.buy.id
        : entry.buy.kind === 'armor' ? player.loadout.armor > 0
        : entry.buy.kind === 'kit' ? player.loadout.kit
        : player.loadout.grenades[entry.buy.id] >= 2;
      entry.row.classList.toggle('owned', owned);
      entry.row.classList.toggle('disabled', owned || !(canBuy && player.money >= entry.price));
      entry.priceEl.textContent = owned ? (entry.buy.kind === 'grenade' ? 'FULL' : 'OWNED') : `$${entry.price}`;
    }
  }

  function renderScoreboard(state) {
    refs.scoreRows.innerHTML = '';
    const sorted = [...state.actors].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    for (const actor of sorted) {
      const row = document.createElement('div');
      row.className = 'score-row';
      const name = document.createElement('span');
      name.className = `score-name ${actor.team}`;
      name.textContent = `${actor.name}${actor.isPlayer ? ' (YOU)' : ''}${state.bomb.carrier === actor ? ' ●' : ''}`;
      const team = document.createElement('span');
      team.textContent = TEAM_NAME[actor.team];
      const kills = document.createElement('span');
      kills.textContent = String(actor.kills);
      const deaths = document.createElement('span');
      deaths.textContent = String(actor.deaths);
      const money = document.createElement('span');
      money.textContent = `$${actor.money}`;
      row.append(name, team, kills, deaths, money);
      refs.scoreRows.appendChild(row);
    }
  }

  return {
    update,
    renderBuy,
    renderScoreboard,
    addKill,
    showBanner,
    showHitmarker(headshot) {
      hitmarkerUntil = performance.now() / 1000 + 0.12;
      refs.hitmarker.classList.toggle('headshot', Boolean(headshot));
    },
    showDamageFrom(angleDeg) {
      damageUntil = performance.now() / 1000 + 0.8;
      refs.damageDir.style.transform = `translate(-50%, -50%) rotate(${angleDeg}deg)`;
    },
    setCenterMessage(text) {
      setText(refs.centerMsg, 'center', text);
    },
    setHint(text) {
      setText(refs.hint, 'hint', text);
    },
    setBuyVisible(visible) {
      refs.buyMenu.classList.toggle('open', visible);
    },
    setScoreboardVisible(visible) {
      refs.scoreboard.classList.toggle('open', visible);
    },
    showMenu() { refs.menu.style.display = 'flex'; },
    hideMenu() { refs.menu.style.display = 'none'; },
    showPause() { refs.pauseMenu.style.display = 'flex'; },
    hidePause() { refs.pauseMenu.style.display = 'none'; },
    showEndScreen(won, statsText) {
      refs.endTitle.textContent = won ? 'VANGUARD WINS THE MATCH' : 'AEGIS WINS THE MATCH';
      refs.endTitle.style.color = won ? '#f0a832' : '#35c4b5';
      refs.endStats.textContent = statsText;
      refs.endScreen.style.display = 'flex';
    },
    hideEndScreen() { refs.endScreen.style.display = 'none'; },
    setHudVisible(visible) {
      refs.hud.style.display = visible ? 'block' : 'none';
    },
  };
}
