/* ---------------- PANELS ---------------- */
const panelWrap = $('#panelWrap'), panelBody = $('#panelBody');
function openPanel(html, after) {
  panelBody.innerHTML = html;
  panelWrap.classList.add('open');
  gsap.fromTo('#panel', { y: 80, rotation: -6, scale: .85, opacity: 0 }, { y: 0, rotation: -1, scale: 1, opacity: 1, duration: .45, ease: 'back.out(1.8)' });
  gsap.from('#panelBody > *', { opacity: 0, y: 14, stagger: .05, duration: .3, delay: .12 });
  after && after();
}
function closePanel() {
  Sfx.back();
  gsap.to('#panel', { y: 60, rotation: 4, opacity: 0, duration: .25, ease: 'power2.in', onComplete: () => panelWrap.classList.remove('open') });
}
$('#panelClose').addEventListener('click', closePanel);
panelWrap.addEventListener('click', e => { if (e.target === panelWrap) closePanel(); });

/* Loading into the game (shared by Continue / New / Load) */
function bootGame(where) {
  closePanel(); inMenu = false;
  gsap.to('#menu', { opacity: 0, duration: .5, ease: 'power1.inOut', onComplete: () => {
    show('loader'); spireMode = 'loader';
    gsap.set('#menu', { opacity: 1 });
    gsap.fromTo('.load-block', { opacity: 0 }, { opacity: 1, duration: .5 });
    runLoader('Entering ' + where, () => fadeOut(() => { location.href = 'play.html'; }));
  } });
}

const ROSTER = [
  ['Nathan', 'HERO', '#e8361c', 'Loud, cocky, flame‑red. Keeps a spare bat under his pillow.'],
  ['Evil Adam', 'VILLAIN', '#7a1f6e', 'Snapped after one catastrophic loss. Hoards Cursed Trophies.'],
  ['Adam', 'RIVAL', '#3d6ee0', '"Match point!" Honorable duels on the climb.'],
  ['Josh', 'TECH VENDOR', '#2bb673', 'Builds upgrades out of pure spite. Works on his machine.'],
  ['Renas', 'FAST TRAVEL', '#f2c14e', 'Scooter of stolen drone parts. Calls you slowpoke.'],
  ['Reshman', 'MAP SCOUT', '#0d0b10', 'Jittery shadow‑blob in dark corners. …blorp.'],
  ['Lars', 'BLACKSMITH', '#a0622d', 'Two cats, one beer, heavy bats. Rock and stone!'],
  ['Daniel', 'ACT I BOSS', '#ff8a2a', 'Pyromaniac. "Improves" fireworks. Lucky bomb.'],
  ['Fionn', 'ACT II BOSS', '#8c7b6b', 'Names every rock he throws. Wants 50 Lucky Pebbles.'],
  ['Milo', 'ACT II BOSS', '#6fd3ff', 'Fried hair, summoned storm. Teaches the Static Dash.'],
  ['Deniz', 'ACT II BOSS', '#b8e3f2', 'Ice king. Knock off his crown, meet a chill hippie.']
];

const ACTIONS = {
  continue: () => bootGame('the Test Room'),
  new: () => openPanel(`
    <div class="confirm"><h2>Step Up to the Plate?<small>A new climb up The Spire begins in the Scrapyard Dugout.</small></h2><div class="rule"></div>
    <p style="font-size:16px">Choose your difficulty:</p>
    <div class="seg" style="justify-content:center;margin-top:12px" id="diff"><button>Little League</button><button class="on">Varsity</button><button>Major League</button><button>Steel Spire</button></div>
    <div class="btns"><button class="btn" onclick="closePanel()">Not yet</button><button class="btn primary" onclick="bootGame('the Scrapyard Dugout')">Play Ball!</button></div></div>`, () => segs()),
  load: () => openPanel(`
    <h2>Load Game<small>Pick a save. Reshman updated the maps.</small></h2><div class="rule"></div>
    <div class="slots">
      <button class="slot" onclick="bootGame('the Storm Atrium')"><span class="slot-n">I</span><span><b>Storm Atrium</b><p>Act II · 2 / 3 Golden Pennants · 31 Lucky Pebbles · 14h 22m</p></span><span class="pct">58%</span></button>
      <button class="slot" onclick="bootGame('the Pyrotechnic Foundry')"><span class="slot-n">II</span><span><b>Pyrotechnic Foundry</b><p>Act I · Daniel defeated · 4 friends rescued · 3h 05m</p></span><span class="pct">17%</span></button>
      <button class="slot empty" onclick="ACTIONS.new()"><span class="slot-n">III</span><span><b>Empty Slot</b><p>Start a new climb</p></span><span class="pct">—</span></button>
    </div>`),
  options: () => openPanel(`
    <h2>Options<small>Tuned by Josh. Out of spite.</small></h2><div class="rule"></div>
    <div class="tabs"><button class="tab on" data-t="audio">Audio</button><button class="tab" data-t="video">Video</button><button class="tab" data-t="controls">Controls</button></div>
    <div data-pane="audio">
      ${[['master', 'Master'], ['music', 'Music'], ['sfx', 'Effects']].map(([k, l]) => `<div class="row"><label>${l}</label><input type="range" min="0" max="100" value="${settings[k]}" data-k="${k}"><output>${settings[k]}</output></div>`).join('')}
      <div class="row"><label>Subtitles</label><button class="toggle ${settings.subtitles ? 'on' : ''}" data-k="subtitles"></button><span></span></div>
    </div>
    <div data-pane="video" hidden>
      <div class="row"><label>Screen Shake</label><button class="toggle ${settings.shake ? 'on' : ''}" data-k="shake"></button><span></span></div>
      <div class="row"><label>Lightning Flashes</label><button class="toggle ${settings.flashes ? 'on' : ''}" data-k="flashes"></button><span></span></div>
      <div class="row"><label>Embers</label><div class="seg" data-k="particles">${['Low', 'Medium', 'High'].map(v => `<button class="${settings.particles === v ? 'on' : ''}">${v}</button>`).join('')}</div><span></span></div>
      <div class="row"><label>Ink Outline</label><div class="seg"><button>Thin</button><button class="on">Bold</button><button>Comic</button></div><span></span></div>
    </div>
    <div data-pane="controls" hidden><div class="binds">
      ${[['Move', 'A / D'], ['Jump', 'Space'], ['Bat Swing', 'J'], ['Throw Ball', 'K'], ['Bat‑Launch', 'K → J'], ['Burn Hype (Heal)', 'H'], ['Static Dash', 'Shift'], ['Map', 'Tab']].map(([a, k]) => `<div class="bind"><span>${a}</span><kbd>${k}</kbd></div>`).join('')}
    </div></div>`, wireOptions),
  extras: () => openPanel(`
    <h2>The Dugout<small>Everyone you rescue (or beat) ends up here.</small></h2><div class="rule"></div>
    <div class="roster">${ROSTER.map(([n, r, c, d]) => `<div class="card" style="--c:${c}"><div class="av">${n[0]}</div><b>${n}</b><small>${r}</small><p>${d}</p></div>`).join('')}</div>`),
  credits: () => openPanel(`
    <h2>Credits<small>Extra Innings · an Ibrahim Interactive production</small></h2><div class="rule"></div>
    <div class="credits">
      <div><h4>GAME DIRECTOR</h4><p>You</p></div>
      <div><h4>LEAD HERO</h4><p>Nathan "MVP" — #7</p></div>
      <div><h4>VILLAINY CONSULTANT</h4><p>Evil Adam</p></div>
      <div><h4>ENGINEERING (SPITE)</h4><p>Josh</p></div>
      <div><h4>LOGISTICS &amp; SCOOTERS</h4><p>Renas</p></div>
      <div><h4>CARTOGRAPHY</h4><p>Reshman (…blorp)</p></div>
      <div><h4>METALLURGY &amp; CATS</h4><p>Lars</p></div>
      <div><h4>PYROTECHNICS</h4><p>Daniel (unlicensed)</p></div>
      <div><h4>GEOLOGY</h4><p>Fionn &amp; every named rock</p></div>
      <div><h4>WEATHER</h4><p>Milo</p></div>
      <div><h4>CLIMATE CONTROL</h4><p>Deniz</p></div>
      <div><h4>SPECIAL THANKS</h4><p>The Spare Bat</p></div>
    </div>`),
  quit: () => openPanel(`
    <div class="confirm"><h2>Forfeit the Match?<small>Your friends are still trapped in The Spire.</small></h2><div class="rule"></div>
    <div class="btns"><button class="btn primary" onclick="closePanel()">Keep Climbing</button><button class="btn" id="forfeit">Forfeit</button></div></div>`, () => {
      $('#forfeit').onclick = () => { closePanel(); Sfx.boom(); shake(14); pow(innerWidth / 2, innerHeight / 2, 'FOUL BALL!', 72); };
    })
};

function segs() {
  $$('#panelBody .seg').forEach(s => s.querySelectorAll('button').forEach(b => b.onclick = () => {
    s.querySelectorAll('button').forEach(x => x.classList.remove('on')); b.classList.add('on'); Sfx.tick();
    if (s.dataset.k) settings[s.dataset.k] = b.textContent;
  }));
}
function wireOptions() {
  segs();
  $$('#panelBody .tab').forEach(t => t.onclick = () => {
    Sfx.tick();
    $$('#panelBody .tab').forEach(x => x.classList.toggle('on', x === t));
    $$('#panelBody [data-pane]').forEach(p => p.hidden = p.dataset.pane !== t.dataset.t);
    gsap.from(`#panelBody [data-pane="${t.dataset.t}"] > *`, { opacity: 0, x: -14, stagger: .04, duration: .25 });
  });
  $$('#panelBody input[type=range]').forEach(r => r.oninput = () => {
    settings[r.dataset.k] = +r.value; r.nextElementSibling.textContent = r.value;
    Sfx.setVol(); Sfx.setMusic();
  });
  $$('#panelBody input[type=range]').forEach(r => r.onchange = () => Sfx.tick());
  $$('#panelBody .toggle').forEach(t => t.onclick = () => {
    settings[t.dataset.k] = !settings[t.dataset.k]; t.classList.toggle('on'); Sfx.tick();
  });
}
