import * as THREE from 'three';
import { GardenWorld } from './World.js';
import { Player } from './Player.js';
import { Enemy } from './Enemy.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import nipplejs from 'nipplejs';
import JSZip from 'jszip';

class Game {
    constructor() {
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.shadowMap.enabled = true;
        document.body.appendChild(this.renderer.domElement);

        this.world = new GardenWorld(this.scene, { vegetation: true });
        this.player = new Player(this.scene);
        // give world access to player position for banana following
        this.world.playerPosition = this.player.mesh.position;

        // --- Holiday event detection: Christmas + Halloween ---
        const now = new Date();
        const month = now.getMonth(); // 0 = Jan, 11 = Dec
        const day = now.getDate();
        const year = now.getFullYear();

        // Christmas: Start if December (11) or January (0), run until Feb 1 of the corresponding year
        const christmasStart = (month === 11 || month === 0);
        const christmasEndDate = new Date(year + (month === 11 ? 1 : 0), 1, 1); // Feb 1 next year if Dec else Feb 1 this year
        const beforeFeb1 = now < christmasEndDate;
        this.christmasMode = christmasStart && beforeFeb1;

        // Halloween: Start if October (9) or November (10) and end Dec 1
        const halloweenStart = (month === 9 || month === 10);
        const halloweenEndDate = new Date(year + (month === 9 && month === 11 ? 1 : 0), 11, 1); // Dec 1 (year logic safe fallback)
        // simpler: Halloween active if month Oct or Nov until Dec 1
        this.halloweenMode = halloweenStart && (now < new Date(year, 11, 1));

        // Update announcement UI to reflect Halloween event status
        try {
            const annEl = document.getElementById('announcement-text');
            if (annEl) {
                if (this.halloweenMode) {
                    annEl.textContent = 'HALLOWEEN EVENT ACTIVE: October–November — Find Jack O\'Lanterns (press A) to protect your pets!';
                } else {
                    // Show upcoming seasonal note so players know when it starts
                    annEl.textContent = 'HALLOWEEN EVENT: Runs Oct–Nov — starts automatically in October or November. Collect Jack O\'Lanterns (A) to protect pets!';
                }
            }
        } catch (e) {
            console.warn('Failed to update announcement for Halloween', e);
        }

        // manual console overrides
        window.forceChristmas = (v) => {
            this.christmasMode = Boolean(v);
            if (this.world && typeof this.world.applyChristmas === 'function') {
                this.world.applyChristmas(this.christmasMode);
                this.scene.userData.christmas = this.christmasMode;
            }
        };
        window.forceHalloween = (v) => {
            this.halloweenMode = Boolean(v);
            if (this.world && typeof this.world.applyHalloween === 'function') {
                this.world.applyHalloween(this.halloweenMode);
                this.scene.userData.halloween = this.halloweenMode;
            }
        };

        // apply to world immediately
        if (this.world && typeof this.world.applyChristmas === 'function') {
            this.world.applyChristmas(this.christmasMode);
            this.scene.userData.christmas = this.christmasMode;
        }
        if (this.world && typeof this.world.applyHalloween === 'function') {
            this.world.applyHalloween(this.halloweenMode);
            this.scene.userData.halloween = this.halloweenMode;
        }
        
        this.camera.position.set(0, 10, 10);
        this.camera.lookAt(0, 0, 0);

        this.input = { x: 0, y: 0, isDown: false };
        this.setupControls();
        this.setupParrotControls();
        this.setupTeleportControls();

        // Vegetation toggle: press 'v' and type "true" or "false" to enable/disable bushes & flowers
        window.addEventListener('keydown', (e) => {
            if (e.key.toLowerCase() !== 'v') return;
            const ans = window.prompt('Enable vegetation? type true or false', String(this.world.settings.vegetation !== false));
            if (ans === null) return;
            const val = String(ans).trim().toLowerCase();
            if (val === 'true') {
                this.world.settings.vegetation = true;
                this.world.rebuildVegetation();
            } else if (val === 'false') {
                this.world.settings.vegetation = false;
                this.world.rebuildVegetation();
            } else {
                alert('Please type true or false');
            }
        });
        
        this.gameState = {
            day: 1,
            maxDays: 7,
            dayDuration: 25, // seconds
            timer: 0,
            pets: 0,
            plantProgress: 0,
            isSurvival: false,
            gameOver: false,
            bananaTouched: false,
            // Daily challenge state (1 hour countdown)
            challengeSeconds: 3600,
            points: 0
        };
        this.enemies = [];
        this.enemySpawnTimer = 0;
        this.petGuards = []; // guards spawned to protect pets

        // Hook up announcement / daily challenge UI
        this._challengeTimerEl = document.getElementById('challenge-timer');
        this._claimBtn = document.getElementById('claim-diamond');
        this._pointsEl = document.getElementById('points-counter');
        this._announcementText = document.getElementById('announcement-text');

        // Alerts toggle state (ESC settings)
        this.alertsEnabled = true;
        // Wire up ESC settings UI (toggle, details, remake, save)
        const escToggle = document.getElementById('esc-settings-toggle');
        const escDetails = document.getElementById('esc-details');
        const remakeBtn = document.getElementById('remake-btn');
        const saveStateBtn = document.getElementById('save-state-btn');

        if (escToggle) {
            escToggle.addEventListener('click', () => {
                this.alertsEnabled = !this.alertsEnabled;
                escToggle.textContent = this.alertsEnabled ? 'On' : 'Off';
                escToggle.style.background = this.alertsEnabled ? '#4CAF50' : '#bdbdbd';
                escToggle.setAttribute('aria-pressed', String(this.alertsEnabled));
                // show brief detail when toggled
                if (escDetails) {
                    escDetails.style.display = 'block';
                    escDetails.textContent = this.alertsEnabled
                        ? 'Alerts enabled — emergency overlays and chimes will show.'
                        : 'Alerts disabled — overlays and chimes are suppressed.';
                    setTimeout(() => { try { escDetails.style.display = 'none'; } catch(e){} }, 4000);
                }
            });

            // Support pressing Esc to toggle the emergency overlay or open the Pause Menu (respecting ESC Alerts)
            window.addEventListener('keydown', (ev) => {
                if (ev.key !== 'Escape') return;
                const overlay = document.getElementById('emergency-overlay');
                const pauseMenu = document.getElementById('pause-menu');
                // If alerts are disabled and pause menu desired, show brief details hint
                if (!this.alertsEnabled) {
                    if (escDetails) {
                        escDetails.style.display = 'block';
                        escDetails.textContent = 'Alerts are disabled — enable ESC Alerts to view emergency overlays.';
                        setTimeout(() => { try { escDetails.style.display = 'none'; } catch(e){} }, 3000);
                    }
                    // still allow opening pause menu to manage game state
                }

                // Toggle the pause menu visibility
                if (pauseMenu) {
                    const nowVisible = (pauseMenu.style.display === 'flex');
                    if (!nowVisible) {
                        // Pause game
                        pauseMenu.style.display = 'flex';
                        this.paused = true;
                        // show a short pause message
                        const pm = document.getElementById('pause-msg');
                        if (pm) pm.textContent = 'Game paused. Resume or Leave Game.';
                    } else {
                        // Resume
                        pauseMenu.style.display = 'none';
                        this.paused = false;
                    }
                } else {
                    // fallback: toggle emergency overlay (existing behavior)
                    if (!overlay) return;
                    try {
                        overlay.style.display = (overlay.style.display === 'flex') ? 'none' : 'flex';
                    } catch (e) { console.warn('Could not toggle emergency overlay', e); }
                }
            });

            // Pause menu button wiring (Resume / Leave Game)
            window.addEventListener('load', () => {
                const resumeBtn = document.getElementById('resume-btn');
                const leaveBtn = document.getElementById('leave-btn');
                const menuMusic = document.getElementById('menu-music');
                const downloadBtn = document.getElementById('download-btn');

                if (resumeBtn) {
                    resumeBtn.addEventListener('click', () => {
                        const pauseMenu = document.getElementById('pause-menu');
                        if (pauseMenu) pauseMenu.style.display = 'none';
                        this.paused = false;
                    });
                }

                if (leaveBtn) {
                    leaveBtn.addEventListener('click', async () => {
                        // Show bye message in pause menu and set paused state
                        const pm = document.getElementById('pause-msg');
                        if (pm) pm.textContent = 'Bye — returning to main menu...';

                        // Play the main menu music (ensure AudioContext unlocked)
                        try {
                            if (this.audioContext && this.audioContext.state === 'suspended') {
                                await this.audioContext.resume();
                            }
                        } catch(e){}
                        try {
                            if (menuMusic) {
                                menuMusic.currentTime = 0;
                                menuMusic.play().catch(()=>{});
                            }
                        } catch(e){}

                        // Trigger ZIP download (reuse existing download button flow)
                        try {
                            if (downloadBtn) {
                                downloadBtn.click();
                            } else {
                                // If download button missing, attempt to locate and trigger alternative
                                const alt = document.getElementById('download-btn');
                                if (alt) alt.click();
                            }
                        } catch (e) { console.warn('Failed to trigger download', e); }

                        // Open main menu pages in new tabs (main index and unity README)
                        try {
                            window.open(window.location.origin + window.location.pathname, '_blank');
                            window.open(window.location.origin + '/unity_data/README.txt', '_blank');
                        } catch (e) { console.warn('Failed to open tabs', e); }

                        // Update UI: hide pause menu and mark as paused/stopped
                        const pauseMenu = document.getElementById('pause-menu');
                        if (pauseMenu) pauseMenu.style.display = 'none';
                        this.paused = true;
                    });
                }
            });
        }

        if (remakeBtn) {
            remakeBtn.addEventListener('click', () => {
                // Remake: rebuild vegetation and reset some world pieces
                if (this.world && typeof this.world.rebuildVegetation === 'function') {
                    this.world.rebuildVegetation();
                    this._announcementText.textContent = 'World remade (vegetation rebuilt).';
                    setTimeout(() => { this._announcementText.textContent = 'UPDATES MORE SOON!'; }, 1800);
                }
            });
        }

        if (saveStateBtn) {
            saveStateBtn.addEventListener('click', () => {
                // Simple save: capture a JSON snapshot of minimal gameState and offer download
                try {
                    const snapshot = {
                        gameState: this.gameState,
                        day: this.gameState?.day || 1,
                        points: this.gameState?.points || 0,
                        pets: this.gameState?.pets || 0
                    };
                    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `capybara_save_day${snapshot.day}.json`;
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    URL.revokeObjectURL(url);
                    this._announcementText.textContent = 'Saved game snapshot.';
                    setTimeout(() => { this._announcementText.textContent = 'UPDATES MORE SOON!'; }, 1800);
                } catch (e) {
                    console.warn('Save failed', e);
                    this._announcementText.textContent = 'Save failed.';
                    setTimeout(() => { this._announcementText.textContent = 'UPDATES MORE SOON!'; }, 1800);
                }
            });
        }

        // Donate button: buy 1000 diamonds for 10 points (simple demo)
        // Add a donate button to announcement area dynamically
        const donateBtn = document.createElement('button');
        donateBtn.id = 'donate-btn';
        donateBtn.textContent = 'Donate 10 → 1000💎';
        donateBtn.style.padding = '6px 8px';
        donateBtn.style.borderRadius = '8px';
        donateBtn.style.border = '0';
        donateBtn.style.background = '#FF9800';
        donateBtn.style.color = 'white';
        donateBtn.style.marginLeft = '8px';
        donateBtn.style.cursor = 'pointer';
        document.getElementById('announcement').appendChild(donateBtn);

        donateBtn.addEventListener('click', () => {
            // cost 10 points to receive 1000 diamonds (points treated as currency here)
            if (this.gameState.points < 10) {
                this._announcementText.textContent = "Not enough points to donate.";
                setTimeout(() => { this._announcementText.textContent = "UPDATES MORE SOON!"; }, 1600);
                return;
            }
            this.gameState.points -= 10;
            // credit diamonds (we'll store diamonds on gameState.diamonds)
            this.gameState.diamonds = (this.gameState.diamonds || 0) + 1000;
            this._pointsEl.textContent = this.gameState.points;
            this._announcementText.textContent = "Thanks! You received 1000 diamonds.";
            // visual feedback
            this.spawnDiamondAt(this.world.cashy.position.clone().add(new THREE.Vector3(0,2,0)));
            setTimeout(() => { this._announcementText.textContent = "UPDATES MORE SOON!"; }, 2000);
        });

        this._claimBtn.addEventListener('click', () => {
            if (this.gameState.challengeSeconds > 0) return;
            // Award a point (diamond) and respawn the hour timer
            this.gameState.points++;
            this._pointsEl.textContent = this.gameState.points;
            this._announcementText.textContent = "Diamond awarded! +1 point";
            this._claimBtn.disabled = true;
            this._claimBtn.style.background = '#bdbdbd';
            // spawn a temporary diamond sprite near Cashy as feedback
            this.spawnDiamondAt(this.world.cashy.position.clone().add(new THREE.Vector3(0,2,0)));
            this.gameState.challengeSeconds = 3600; // reset 1 hour
            setTimeout(() => { this._announcementText.textContent = "UPDATES MORE SOON!"; }, 2000);
        });

        // Download packaged ZIP button (creates a README.txt and a placeholder .exe file)
        const downloadBtn = document.getElementById('download-btn');
        if (downloadBtn) {
            downloadBtn.addEventListener('click', async () => {
                try {
                    const zip = new JSZip();
                    const readme = `Capybara Garden\n\nThis archive contains a placeholder Windows .exe and README for the Capybara Garden app.\n\nIcon file: channels4_profile (4).jpg (included in project assets). This packaged EXE is a placeholder created in-browser for demo purposes and does not contain a real installed application.\n\nTo run the actual game, open the web version in your browser.\n\n-- Capybara Garden Team`;
                    zip.file('README.txt', readme);

                    // Create a small placeholder "exe" file blob (not a real executable)
                    const placeholderExe = new Uint8Array([0x4D,0x5A,0x90,0x00,0x03,0x00,0x00,0x00]); // 'MZ' header fragment
                    zip.file('CapybaraGarden.exe', placeholderExe, { binary: true });

                    // Optionally include a note about icon
                    zip.file('ICON.txt', 'Use channels4_profile (4).jpg as the application icon.');

                    const content = await zip.generateAsync({ type: 'blob' });
                    const url = URL.createObjectURL(content);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'Capybara_Garden.zip';
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    URL.revokeObjectURL(url);
                    this._announcementText.textContent = "Download ready — saved Capybara_Garden.zip";
                    setTimeout(() => { this._announcementText.textContent = "UPDATES MORE SOON!"; }, 2500);
                } catch (e) {
                    console.error('Download failed', e);
                    this._announcementText.textContent = "Download failed.";
                    setTimeout(() => { this._announcementText.textContent = "UPDATES MORE SOON!"; }, 2500);
                }
            });
        }

        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        this.sounds = {};
        this.loadSounds();

        // Debug overlay (toggle with F8)
        this._debugVisible = false;
        this._debugOverlay = document.createElement('div');
        this._debugOverlay.style.position = 'fixed';
        this._debugOverlay.style.left = '10px';
        this._debugOverlay.style.top = '10px';
        this._debugOverlay.style.padding = '8px 10px';
        this._debugOverlay.style.background = 'rgba(0,0,0,0.7)';
        this._debugOverlay.style.color = 'white';
        this._debugOverlay.style.fontFamily = 'monospace';
        this._debugOverlay.style.fontSize = '12px';
        this._debugOverlay.style.zIndex = '99999';
        this._debugOverlay.style.borderRadius = '8px';
        this._debugOverlay.style.display = 'none';
        // make overlay touchable for mobile so players can tap links
        this._debugOverlay.style.pointerEvents = 'auto';
        this._debugOverlay.style.maxWidth = '320px';
        this._debugOverlay.style.lineHeight = '1.3';
        document.body.appendChild(this._debugOverlay);

        // Add Modmaker header / quick actions container inside debug overlay
        const modHeader = document.createElement('div');
        modHeader.style.fontWeight = '700';
        modHeader.style.marginBottom = '6px';
        modHeader.innerText = 'MODMAKER — Capybara Garden';
        this._debugOverlay.appendChild(modHeader);

        const modWelcome = document.createElement('div');
        modWelcome.style.fontSize = '12px';
        modWelcome.style.marginBottom = '6px';
        modWelcome.innerHTML = `Welcome to Modmaker — create & remix mods. See tutorials & publish on <a href="https://websim.com/@/capybara-garden" target="_blank" style="color:#88f;text-decoration:underline;">websim.com/@/capybara-garden</a> (add your name after @).`;
        this._debugOverlay.appendChild(modWelcome);

        const modTips = document.createElement('div');
        modTips.style.fontSize = '11px';
        modTips.style.color = '#ddd';
        modTips.style.marginBottom = '6px';
        modTips.innerHTML = `<strong>Quick tips:</strong><br>• Create mods: scripts, objects, settings.<br>• Publish: add description, comments, deps and login to Websim.<br>• Need help? See tutorials on the project page.`;
        this._debugOverlay.appendChild(modTips);

        // small separator
        const sep = document.createElement('hr');
        sep.style.border = 'none';
        sep.style.borderTop = '1px solid rgba(255,255,255,0.06)';
        sep.style.margin = '6px 0';
        this._debugOverlay.appendChild(sep);

        // Key handlers: F2/F8/F10 and E (player swap) + D to shoot
        window.addEventListener('keydown', (e) => {
            // F2: force-disable emergency alerts (silent helper + UI update)
            if (e.key === 'F2') {
                this.alertsEnabled = false;
                try {
                    const escToggleEl = document.getElementById('esc-settings-toggle');
                    if (escToggleEl) {
                        escToggleEl.textContent = 'Off';
                        escToggleEl.style.background = '#bdbdbd';
                        escToggleEl.setAttribute('aria-pressed', 'false');
                    }
                    const escDetailsEl = document.getElementById('esc-details');
                    if (escDetailsEl) {
                        escDetailsEl.style.display = 'block';
                        escDetailsEl.textContent = 'Alerts have been turned off via F2 — emergency overlays and chimes are suppressed.';
                        setTimeout(() => { try { escDetailsEl.style.display = 'none'; } catch(e){} }, 3000);
                    }
                } catch (err) { console.warn('Failed to update ESC UI after F2', err); }
                return;
            }

            // A: pick up / give Jack O'Lantern to nearby pet to protect pets for 8 seconds
            if (e.key.toLowerCase() === 'a') {
                try {
                    // must have a jack lantern present and be near it to pick up
                    const pPos = this.player.mesh.position;
                    if (this.world && this.world.jackLantern && this.world.jackLantern.position) {
                        const d = pPos.distanceTo(this.world.jackLantern.position);
                        if (d < 2.0 && !this._holdingLantern) {
                            this._holdingLantern = true;
                            // attach lantern to player (simple follow)
                            this.world.jackLantern.visible = false;
                            this._announcementText.textContent = 'You picked up the Jack O\'Lantern — press A near a pet to give it!';
                            setTimeout(() => { if (this._announcementText) this._announcementText.textContent = 'UPDATES MORE SOON!'; }, 2200);
                            return;
                        }
                    }
                    // if holding, try give to nearest pet (cash y, builderG, banana)
                    if (this._holdingLantern) {
                        const pets = ['cashy','builderG','dancingBanana'];
                        let givenTo = null;
                        for (const key of pets) {
                            try {
                                const pet = this.world[key];
                                if (!pet || !pet.position) continue;
                                const dist = pPos.distanceTo(pet.position);
                                if (dist < 3.0) {
                                    // give lantern: set protection until now + 8s
                                    pet.userData = pet.userData || {};
                                    pet.userData.protectedUntil = Date.now() + 8000;
                                    givenTo = key;
                                    // visual feedback: tint pet and bounce
                                    try { if (pet.material && pet.material.color) pet.material.color.setHex(0xffcc66); } catch(e){}
                                    try { pet.bounce && pet.bounce(); } catch(e){}
                                }
                            } catch(e){}
                        }
                        if (givenTo) {
                            this._holdingLantern = false;
                            this._announcementText.textContent = `Lantern given to ${givenTo} — pets protected for 8s!`;
                            if (this.alertsEnabled) this.playSound('day');
                            setTimeout(() => { if (this._announcementText) this._announcementText.textContent = 'UPDATES MORE SOON!'; }, 2200);
                            return;
                        } else {
                            // drop lantern at player position if not near pet
                            this._holdingLantern = false;
                            this.world.jackLantern.position.copy(this.player.mesh.position.clone().add(new THREE.Vector3(0,0.8,0)));
                            this.world.jackLantern.visible = true;
                            this._announcementText.textContent = 'Lantern dropped.';
                            setTimeout(() => { if (this._announcementText) this._announcementText.textContent = 'UPDATES MORE SOON!'; }, 1600);
                            return;
                        }
                    }
                } catch (err) {
                    console.warn('A key handler failed', err);
                }
            }

            if (e.key === 'F8') {
                // Open private play link and toggle debug overlay
                try { window.open('https://websim.com/@yellowerfan33/capybara-garden-privated-edition', '_blank'); } catch(e){}
                this._debugVisible = !this._debugVisible;
                this._debugOverlay.style.display = this._debugVisible ? 'block' : 'none';
                if (this._debugVisible) {
                    this._updateDebugInfo();
                }
                return;
            }

            // F10: quick spawn command prompt — ask what to spawn and handle "infectors dede" / myth variant
            if (e.key === 'F10') {
                try {
                    const choice = window.prompt('F10 Spawn — what do you spawn? (e.g. infectors dede, myth infectors, banana)', 'infectors dede');
                    if (!choice) return;
                    const cmd = String(choice).trim().toLowerCase();

                    // If user requested infectors dede (or similar), call existing spawn and optionally spawn a myth wave
                    if (cmd.includes('infectors') || cmd.includes('dede')) {
                        // normal spawn
                        try { window.spawnInfectorsDede(); } catch (err) { console.warn('spawnInfectorsDede failed', err); }

                        // if user explicitly asked for a "myth" variant, spawn an enhanced wave
                        if (cmd.includes('myth') || cmd.includes('legend') || cmd.includes('mythic')) {
                            // spawn additional stronger enemies around the player
                            const p = this.player.mesh.position.clone();
                            for (let i = 0; i < 14; i++) {
                                const angle = Math.random() * Math.PI * 2;
                                const r = 4 + Math.random() * 12;
                                const spawnPos = new THREE.Vector3(p.x + Math.cos(angle) * r, 0, p.z + Math.sin(angle) * r);
                                const extra = new Enemy(this.scene, spawnPos);
                                // buff the enemy: faster and slightly larger visual scale if possible
                                try {
                                    extra.speed = (extra.speed || 2.5) * 1.6;
                                    if (extra.mesh && extra.mesh.scale) extra.mesh.scale.multiplyScalar(1.25);
                                } catch (e) {}
                                this.enemies.push(extra);
                            }
                            if (this._announcementText) {
                                this._announcementText.textContent = 'MYTH INFECTORS: A stronger storm approaches!';
                                setTimeout(() => { this._announcementText.textContent = 'UPDATES MORE SOON!'; }, 3000);
                            }
                            if (this.alertsEnabled) this.playSound('day');
                        }
                        return;
                    }

                    // fallback: simple keyword handling for other spawns
                    if (cmd.includes('banana')) {
                        // toggle jelly song / banana follow for a fun effect
                        if (!this.jellySource) {
                            this.playSound('jelly');
                            if (this.world && this.world.dancingBanana) {
                                this.world.dancingBanana.following = true;
                                this.world.dancingBanana.bounce();
                            }
                        } else {
                            this.stopJelly();
                        }
                        return;
                    }

                    // unknown: show short notice
                    if (this._announcementText) {
                        this._announcementText.textContent = `Spawn command "${choice}" not recognized.`;
                        setTimeout(() => { this._announcementText.textContent = 'UPDATES MORE SOON!'; }, 1800);
                    }
                } catch (err) {
                    console.warn('F10 spawn handler error', err);
                }
            }

            // E: change player avatar (prompt choices)
            if (e.key.toLowerCase() === 'e') {
                try {
                    const choice = window.prompt('Change player to which character? (builder g, cashy, dancing banana, parrot, rooster rudy)', 'rooster rudy');
                    if (!choice) return;
                    const cmd = String(choice).trim().toLowerCase();

                    if (cmd.includes('rooster') || cmd.includes('rudy') || cmd.includes('rooster rudy')) {
                        // load GLB model and replace player mesh
                        if (!this._gltfLoader) this._gltfLoader = new GLTFLoader();
                        const modelPath = '/chicken_gun_real_rudy_model (1).glb';
                        this._announcementText.textContent = 'Loading Rooster Rudy...';
                        this._gltfLoader.load(modelPath, (gltf) => {
                            try {
                                // remove previous player mesh/group from scene
                                if (this.player && this.player.mesh) {
                                    try { this.scene.remove(this.player.mesh); } catch(e){}
                                }
                                // create a new group to hold GLTF and align to player properties
                                const g = new THREE.Group();
                                g.add(gltf.scene);
                                // normalize scale & orientation (tweak if model appears off)
                                const bbox = new THREE.Box3().setFromObject(g);
                                const size = new THREE.Vector3();
                                bbox.getSize(size);
                                const maxDim = Math.max(size.x, size.y, size.z) || 1;
                                const scale = 1.5 / maxDim;
                                g.scale.setScalar(scale);
                                g.position.copy(this.player?.mesh?.position || new THREE.Vector3(0,0,0));
                                g.position.y = 0; // ground align
                                g.castShadow = true;
                                this.player.mesh = g; // reassign player's mesh reference
                                this.scene.add(this.player.mesh);
                                if (this.world) this.world.playerPosition = this.player.mesh.position;
                                this._announcementText.textContent = 'Player changed to Rooster Rudy!';
                                setTimeout(() => { this._announcementText.textContent = 'UPDATES MORE SOON!'; }, 1600);
                            } catch (err) {
                                console.warn('Failed to swap in Rooster Rudy', err);
                                this._announcementText.textContent = 'Failed to load model.';
                                setTimeout(() => { this._announcementText.textContent = 'UPDATES MORE SOON!'; }, 1600);
                            }
                        }, undefined, (err) => {
                            console.error('GLTF load error', err);
                            this._announcementText.textContent = 'Failed to load Rooster Rudy.';
                            setTimeout(() => { this._announcementText.textContent = 'UPDATES MORE SOON!'; }, 1600);
                        });
                        return;
                    }

                    // handle a few simple text options by recreating simple sprites/meshes
                    if (cmd.includes('builder')) {
                        // set a simple builderG-look by using world.builderG sprite if present
                        if (this.world && this.world.builderG) {
                            try {
                                if (this.player && this.player.mesh) this.scene.remove(this.player.mesh);
                                const sprite = this.world.builderG.clone();
                                sprite.position.copy(this.player.mesh.position || new THREE.Vector3(0,0,0));
                                this.player.mesh = sprite;
                                this.scene.add(this.player.mesh);
                                if (this.world) this.world.playerPosition = this.player.mesh.position;
                                this._announcementText.textContent = 'Player changed to Builder G.';
                                setTimeout(() => { this._announcementText.textContent = 'UPDATES MORE SOON!'; }, 1200);
                            } catch(e){ console.warn(e); }
                        }
                        return;
                    }

                    if (cmd.includes('cashy')) {
                        if (this.world && this.world.cashy) {
                            try {
                                if (this.player && this.player.mesh) this.scene.remove(this.player.mesh);
                                const sprite = this.world.cashy.clone();
                                sprite.position.copy(this.player.mesh.position || new THREE.Vector3(0,0,0));
                                this.player.mesh = sprite;
                                this.scene.add(this.player.mesh);
                                if (this.world) this.world.playerPosition = this.player.mesh.position;
                                this._announcementText.textContent = 'Player changed to Cashy.';
                                setTimeout(() => { this._announcementText.textContent = 'UPDATES MORE SOON!'; }, 1200);
                            } catch(e){ console.warn(e); }
                        }
                        return;
                    }

                    if (cmd.includes('banana')) {
                        if (this.world && this.world.dancingBanana) {
                            try {
                                if (this.player && this.player.mesh) this.scene.remove(this.player.mesh);
                                const sprite = this.world.dancingBanana.clone();
                                sprite.position.copy(this.player.mesh.position || new THREE.Vector3(0,0,0));
                                this.player.mesh = sprite;
                                this.scene.add(this.player.mesh);
                                if (this.world) this.world.playerPosition = this.player.mesh.position;
                                this._announcementText.textContent = 'Player changed to Dancing Banana.';
                                setTimeout(() => { this._announcementText.textContent = 'UPDATES MORE SOON!'; }, 1200);
                            } catch(e){ console.warn(e); }
                        }
                        return;
                    }

                    if (cmd.includes('parrot')) {
                        if (this.world && this.world.parrot) {
                            try {
                                if (this.player && this.player.mesh) this.scene.remove(this.player.mesh);
                                const sprite = this.world.parrot.clone();
                                sprite.position.copy(this.player.mesh.position || new THREE.Vector3(0,0,0));
                                this.player.mesh = sprite;
                                this.scene.add(this.player.mesh);
                                if (this.world) this.world.playerPosition = this.player.mesh.position;
                                this._announcementText.textContent = 'Player changed to Parrot.';
                                setTimeout(() => { this._announcementText.textContent = 'UPDATES MORE SOON!'; }, 1200);
                            } catch(e){ console.warn(e); }
                        }
                        return;
                    }

                    // unknown choice feedback
                    if (this._announcementText) {
                        this._announcementText.textContent = `Choice "${choice}" not recognised.`;
                        setTimeout(() => { this._announcementText.textContent = 'UPDATES MORE SOON!'; }, 1600);
                    }
                } catch (err) {
                    console.warn('E key handler error', err);
                }
            }

            // D: shoot forward and damage nearby enemies in a cone
            if (e.key.toLowerCase() === 'd') {
                try {
                    // small cooldown to avoid spam (300ms)
                    if (!this._lastShootTime || (Date.now() - this._lastShootTime) > 300) {
                        this._lastShootTime = Date.now();

                        // visual feedback: short-lived muzzle flash sphere
                        try {
                            const origin = this.player.mesh.position.clone();
                            origin.y += 0.9;
                            const mat = new THREE.MeshStandardMaterial({ color: 0xffff66, emissive: 0xffaa33, transparent: true, opacity: 0.95 });
                            const geom = new THREE.SphereGeometry(0.15, 8, 6);
                            const flash = new THREE.Mesh(geom, mat);
                            flash.position.copy(origin);
                            this.scene.add(flash);
                            setTimeout(() => { try { this.scene.remove(flash); } catch(e){} }, 120);
                        } catch (e) {}

                        // compute forward vector from player rotation (Y axis)
                        const forward = new THREE.Vector3(0, 0, -1);
                        forward.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.player.mesh.rotation.y || 0);
                        // shoot range and cone angle
                        const range = 14;
                        const maxAngle = 0.9; // radians (~51deg)
                        let hits = 0;

                        for (const en of this.enemies) {
                            try {
                                if (!en || !en.alive) continue;
                                const pos = en.mesh ? en.mesh.position : (en.position || new THREE.Vector3());
                                const toEnemy = new THREE.Vector3().subVectors(pos, this.player.mesh.position);
                                toEnemy.y = 0;
                                const dist = toEnemy.length();
                                if (dist > range) continue;
                                const dir = toEnemy.clone().normalize();
                                const ang = Math.acos(Math.max(-1, Math.min(1, forward.dot(dir))));
                                if (ang <= maxAngle) {
                                    // destroy enemy
                                    try { en.destroy(); } catch (err) {
                                        if (en.mesh) try { this.scene.remove(en.mesh); } catch(e){}
                                    }
                                    hits++;
                                }
                            } catch (err) {}
                        }

                        // play a shooting/bomb sound to indicate hit
                        if (this.alertsEnabled) this.playSound('bomb');

                        if (this._announcementText) {
                            this._announcementText.textContent = `Shot fired${hits ? ' — hits: ' + hits : ''}`;
                            setTimeout(() => { this._announcementText.textContent = 'UPDATES MORE SOON!'; }, 1000);
                        }
                    }
                } catch (err) {
                    console.warn('D key shoot handler error', err);
                }
            }

            // S: throw bomb (kills nearby enemies)
            if (e.key.toLowerCase() === 's') {
                try {
                    // small cooldown to avoid spam
                    if (!this._lastBombTime || (Date.now() - this._lastBombTime) > 800) {
                        this._lastBombTime = Date.now();
                        if (typeof this.throwBomb === 'function') this.throwBomb();
                        if (this._announcementText) {
                            this._announcementText.textContent = 'Bomb thrown!';
                            setTimeout(() => { this._announcementText.textContent = 'UPDATES MORE SOON!'; }, 1200);
                        }
                    }
                } catch (err) {
                    console.warn('S key bomb handler error', err);
                }
            }
        });

        // update debug overlay each frame if visible (includes modmaker info)
        this._updateDebugInfo = () => {
            try {
                const pos = this.player.mesh.position;
                const enemies = this.enemies.filter(en => en.alive).length;
                // preserve existing nodes (header, welcome, tips) and append dynamic details below
                // remove any existing dynamic block to refresh
                const existingDyn = this._debugOverlay.querySelector('.debug-dynamic');
                if (existingDyn) existingDyn.remove();

                const dyn = document.createElement('div');
                dyn.className = 'debug-dynamic';
                dyn.style.marginTop = '6px';
                dyn.style.fontFamily = 'monospace';
                dyn.style.fontSize = '12px';
                dyn.style.color = '#fff';
                dyn.innerHTML = `
                    <div style="font-weight:700;margin-bottom:4px;">DEBUG</div>
                    <div>pos: ${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}, ${pos.z.toFixed(2)}</div>
                    <div>day: ${this.gameState.day} • survival: ${this.gameState.isSurvival}</div>
                    <div>enemies: ${enemies} • fps: ~60</div>
                    <div>holiday: ${this.halloweenMode ? 'Halloween' : (this.christmasMode ? 'Christmas' : 'none')}</div>
                    <div style="margin-top:6px;font-size:11px;color:#cfd;">Mod actions: Press F10 to open spawn command; Press E to swap player; Press V to toggle vegetation.</div>
                `;
                this._debugOverlay.appendChild(dyn);
            } catch (e) {
                // fallback: simple text
                try { this._debugOverlay.innerText = 'DEBUG: unavailable'; } catch(e){}
            }
        };

        // Bush-stay and special "infectors dede" trigger support
        this._bushStayTimer = 0; // seconds player has stayed in bush area
        this._bushStayRequired = 4; // required seconds to enable spawn
        this._canSpawnInfectorsDede = false;
        this._infectorsDedeSpawned = false;

        // Expose command function (also callable from console)
        window.spawnInfectorsDede = () => {
            if (!this._canSpawnInfectorsDede || this._infectorsDedeSpawned) return;
            this._infectorsDedeSpawned = true;

            // Remove parrot, timeG, and cashy (they are killed by infectors)
            try { if (this.world.parrot) { this.scene.remove(this.world.parrot); this.world.parrot = null; } } catch(e){}
            try { if (this.world.timeG) { this.scene.remove(this.world.timeG); this.world.timeG = null; } } catch(e){}
            try { if (this.world.cashy) { this.scene.remove(this.world.cashy); this.world.cashy = null; } } catch(e){}

            // Storm / day-time change: darkened sky + heavy fog
            try {
                this.scene.background = new THREE.Color(0x0b1220);
                this.scene.fog = new THREE.FogExp2(0x0b1220, 0.09);
            } catch(e){}

            // Spawn a heavy wave of infectors around the player
            const p = this.player.mesh.position.clone();
            for (let i = 0; i < 28; i++) {
                const angle = Math.random() * Math.PI * 2;
                const r = 6 + Math.random() * 18;
                const spawnPos = new THREE.Vector3(p.x + Math.cos(angle) * r, 0, p.z + Math.sin(angle) * r);
                this.enemies.push(new Enemy(this.scene, spawnPos));
            }

            // Immediate UI feedback
            if (this._announcementText) {
                this._announcementText.textContent = "INFECTORS DEDE: The storm has arrived!";
                setTimeout(() => { this._announcementText.textContent = 'UPDATES MORE SOON!'; }, 3000);
            }

            // Play alert sound if enabled
            if (this.alertsEnabled) this.playSound('day');
        };

        // Allow typing a simple prompt command in window.prompt (quick console use)
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && (window._lastCommandPrompt || false)) {
                // noop fallback so Enter doesn't conflict elsewhere
            }
        });

        // helper: spawn a shark army using the GLTF model; each shark is a lightweight enemy object with update()
        this.spawnSharkArmy = (count = 6) => {
            if (!this._gltfLoader) this._gltfLoader = new GLTFLoader();
            const basePos = this.player.mesh.position.clone();
            for (let i = 0; i < count; i++) {
                const angle = Math.random() * Math.PI * 2;
                const r = 12 + Math.random() * 18;
                const spawnPos = new THREE.Vector3(basePos.x + Math.cos(angle) * r, 0, basePos.z + Math.sin(angle) * r);
                this._gltfLoader.load('/Shark3d_model.glb', (gltf) => {
                    try {
                        const sharkGroup = new THREE.Group();
                        sharkGroup.add(gltf.scene.clone());
                        // orient and scale down if needed
                        const bbox = new THREE.Box3().setFromObject(sharkGroup);
                        const size = new THREE.Vector3();
                        bbox.getSize(size);
                        const maxDim = Math.max(size.x, size.y, size.z) || 1;
                        const scale = 1.2 / maxDim;
                        sharkGroup.scale.setScalar(scale);
                        sharkGroup.position.copy(spawnPos);
                        sharkGroup.position.y = 0.5;
                        sharkGroup.userData.isShark = true;
                        this.scene.add(sharkGroup);

                        // create a simple behavior wrapper compatible with existing enemy handling
                        const sharkEnemy = {
                            alive: true,
                            speed: 4.0 + Math.random() * 1.6,
                            mesh: sharkGroup,
                            update: (targetPos, dt) => {
                                if (!sharkEnemy.alive) return;
                                // move on XZ plane toward target (player or boat)
                                const dir = new THREE.Vector3().subVectors(targetPos, sharkGroup.position);
                                dir.y = 0;
                                if (dir.length() > 0.1) {
                                    dir.normalize();
                                    sharkGroup.position.add(dir.multiplyScalar(sharkEnemy.speed * dt));
                                }
                                // gentle swim bob
                                sharkGroup.position.y = 0.4 + Math.sin(Date.now() * 0.003 + Math.random()) * 0.12;
                                // face movement direction
                                const yaw = Math.atan2(dir.x, dir.z);
                                sharkGroup.rotation.y = yaw;
                            },
                            destroy: () => {
                                sharkEnemy.alive = false;
                                try { this.scene.remove(sharkGroup); } catch (e) {}
                            }
                        };

                        this.enemies.push(sharkEnemy);
                    } catch (err) {
                        console.warn('Failed to spawn shark instance', err);
                    }
                }, undefined, (err) => {
                    console.error('Shark model load failed', err);
                    // fallback: spawn a red sprite enemy if model fails
                    const fallbackPos = spawnPos.clone();
                    const en = new Enemy(this.scene, fallbackPos);
                    en.speed = 3.8;
                    this.enemies.push(en);
                });
            }
        };

        // Spawn a castle boss (King Infectors Dede) + army that targets Cashy (if present)
        this.spawnCastleInfectors = (count = 24) => {
            try {
                const p = this.player.mesh.position.clone();
                // spawn a single boss near player center
                const bossPos = new THREE.Vector3(p.x + 4, 0, p.z + 2);
                const boss = new Enemy(this.scene, bossPos);
                boss.isBoss = true;
                boss.speed = (boss.speed || 2.5) * 0.9; // boss moves slightly slower but is tougher
                try { if (boss.mesh && boss.mesh.scale) boss.mesh.scale.multiplyScalar(2.2); } catch(e){}
                // tag boss visually (redder/emissive)
                try {
                    if (boss.mesh && boss.mesh.material && boss.mesh.material.color) {
                        boss.mesh.material.color.lerp(new THREE.Color(0x990000), 0.6);
                    }
                } catch (e) {}

                // spawn army around the castle (prefer to target Cashy)
                for (let i = 0; i < count; i++) {
                    const angle = Math.random() * Math.PI * 2;
                    const r = 8 + Math.random() * 22;
                    const spawnPos = new THREE.Vector3(p.x + Math.cos(angle) * r, 0, p.z + Math.sin(angle) * r);
                    const en = new Enemy(this.scene, spawnPos);
                    en.speed = (en.speed || 2.5) * (1 + Math.random() * 0.6);
                    this.enemies.push(en);
                }

                // ensure boss is first in the array so it's prioritized in some checks
                this.enemies.unshift(boss);

                // force survival and set an announcement
                this.gameState.isSurvival = true;
                this._announcementText.textContent = "KING INFECTORS DEDE: The castle town is under siege — protect Cashy!";
                if (this.alertsEnabled) this.playSound('day');

                // darken sky slightly for dramatic effect
                try {
                    this.scene.background = new THREE.Color(0x2b2f3a);
                    this.scene.fog = new THREE.FogExp2(0x2b2f3a, 0.04);
                } catch(e){}
            } catch (e) {
                console.warn('spawnCastleInfectors failed', e);
            }
        };

        // --- Earthquake & Tornado mechanics ---
        // Tornado: spawns flying "debris" enemies that circle and damage the house
        this.spawnTornado = (center, intensity = 6, duration = 9000) => {
            try {
                const tornadoGroup = new THREE.Group();
                tornadoGroup.position.copy(center);
                tornadoGroup.userData._tornado = true;
                this.scene.add(tornadoGroup);

                // visual: a simple cylinder-ish spiral (cheap)
                const geom = new THREE.ConeGeometry(1.5, 6, 8, 1, true);
                const mat = new THREE.MeshStandardMaterial({ color: 0x666666, transparent: true, opacity: 0.7, side: THREE.DoubleSide });
                const cone = new THREE.Mesh(geom, mat);
                cone.rotation.x = Math.PI;
                cone.position.y = 3;
                tornadoGroup.add(cone);

                // spawn flying debris enemies around the tornado
                const debrisCount = Math.max(6, Math.floor(intensity * 1.5));
                for (let i = 0; i < debrisCount; i++) {
                    const angle = (i / debrisCount) * Math.PI * 2;
                    const dist = 2 + Math.random() * 6;
                    const spawnPos = new THREE.Vector3(center.x + Math.cos(angle) * dist, 2 + Math.random() * 3, center.z + Math.sin(angle) * dist);
                    // create a lightweight flying enemy wrapper (reuses Enemy but elevates and gives flying update)
                    const debris = new Enemy(this.scene, spawnPos);
                    debris.isFlying = true;
                    debris.speed = 3.5 + Math.random() * 2.5;
                    // tweak sprite for debris look
                    try { if (debris.mesh && debris.mesh.material) debris.mesh.material.color.lerp(new THREE.Color(0x9e7f5a), 0.6); } catch(e){}
                    // override update to circle and occasionally dive at house/player
                    const baseUpdate = debris.update.bind(debris);
                    debris.update = (targetPos, dt) => {
                        if (!debris.alive) return;
                        // circle around tornado center
                        const t = Date.now() * 0.002 + (Math.random() - 0.5);
                        const circ = new THREE.Vector3(
                            center.x + Math.cos(t + i) * (2 + Math.sin(t) * 2),
                            1.5 + Math.abs(Math.sin(Date.now() * 0.003 + i)) * 2.2,
                            center.z + Math.sin(t + i) * (2 + Math.cos(t) * 2)
                        );
                        // move toward circ position
                        const dir = new THREE.Vector3().subVectors(circ, debris.mesh.position);
                        if (dir.length() > 0.1) {
                            dir.normalize();
                            debris.mesh.position.add(dir.multiplyScalar(debris.speed * dt * 0.6));
                        }
                        // occasional dive toward house if close
                        if (Math.random() < 0.004) {
                            const housePos = this.world.houseGroup ? this.world.houseGroup.position.clone().add(new THREE.Vector3(0, 1, 0)) : this.player.mesh.position.clone();
                            const diveDir = new THREE.Vector3().subVectors(housePos, debris.mesh.position).normalize();
                            debris.mesh.position.add(diveDir.multiplyScalar((debris.speed + 2) * dt));
                        }
                        // gentle bob
                        debris.mesh.position.y = 1.2 + Math.abs(Math.sin(Date.now() * 0.005 + i)) * 1.2;
                    };
                    this.enemies.push(debris);
                }

                // Tornado life cycle: slowly rotate and after duration remove tornado and some debris
                const start = Date.now();
                const tick = () => {
                    const t = (Date.now() - start);
                    // rotate cone visually
                    cone.rotation.y += 0.05;
                    // damage house if debris are close frequently
                    if (this.world && this.world.houseGroup) {
                        this.enemies.forEach(en => {
                            try {
                                if (!en.alive || !en.mesh || !en.isFlying) return;
                                const d = en.mesh.position.distanceTo(this.world.houseGroup.position);
                                if (d < 3.0) {
                                    // slightly nudge house pieces / remove windows/parts to simulate destruction
                                    try {
                                        if (this.world.houseGroup.children.length > 0 && Math.random() < 0.12) {
                                            const part = this.world.houseGroup.children.pop();
                                            try { this.scene.remove(part); } catch(e){}
                                        }
                                    } catch(e){}
                                }
                            } catch(e){}
                        });
                    }
                    if (t < duration) {
                        requestAnimationFrame(tick);
                    } else {
                        // cleanup: remove tornado marker (debris persist until their own destruction or removed)
                        try { this.scene.remove(tornadoGroup); } catch(e){}
                    }
                };
                tick();
            } catch (e) {
                console.warn('spawnTornado failed', e);
            }
        };

        // Earthquake: causes enemies to "fall" (drop from the sky and smash) and spawns debris rocks that destroy house
        this.triggerEarthquake = (center, magnitude = 1.0, duration = 8000) => {
            try {
                // Visual shake: quickly jitter camera and world objects for duration
                const shakeStart = Date.now();
                const origCamPos = this.camera.position.clone();
                const shakeTick = () => {
                    const elapsed = Date.now() - shakeStart;
                    const t = elapsed / duration;
                    const strength = (1 - t) * (0.15 * magnitude);
                    this.camera.position.x = origCamPos.x + (Math.random() - 0.5) * strength * 8;
                    this.camera.position.y = origCamPos.y + (Math.random() - 0.5) * strength * 4;
                    this.camera.position.z = origCamPos.z + (Math.random() - 0.5) * strength * 8;
                    if (elapsed < duration) requestAnimationFrame(shakeTick);
                    else this.camera.position.copy(origCamPos);
                };
                shakeTick();

                // spawn a set of falling enemies/debris from above the play area
                const fallCount = Math.max(8, Math.floor(8 * magnitude));
                for (let i = 0; i < fallCount; i++) {
                    const angle = Math.random() * Math.PI * 2;
                    const r = 6 + Math.random() * 26;
                    // spawn high above so they "fall"
                    const spawnPos = new THREE.Vector3(center.x + Math.cos(angle) * r, 12 + Math.random() * 18, center.z + Math.sin(angle) * r);
                    const faller = new Enemy(this.scene, spawnPos);
                    faller.speed = 0.5 + Math.random() * 0.4;
                    // override update: fall rapidly toward ground and create impact
                    faller.update = (targetPos, dt) => {
                        if (!faller.alive) return;
                        // accelerate downward
                        faller.mesh.position.y -= (6 + Math.random() * 8) * dt;
                        // slight lateral drift
                        faller.mesh.position.x += Math.sin(Date.now() * 0.002 + i) * 0.02;
                        faller.mesh.position.z += Math.cos(Date.now() * 0.002 + i) * 0.02;
                        if (faller.mesh.position.y <= 0.8) {
                            // impact: create debris sphere and damage nearby house parts/enemies
                            try {
                                const mat = new THREE.MeshStandardMaterial({ color: 0x7f5e3a, emissive: 0x000000 });
                                const geom = new THREE.SphereGeometry(0.6 + Math.random() * 1.6, 8, 6);
                                const rock = new THREE.Mesh(geom, mat);
                                rock.position.copy(faller.mesh.position);
                                rock.position.y = 0.5;
                                this.scene.add(rock);
                                // remove some house parts if close
                                if (this.world && this.world.houseGroup) {
                                    const dHouse = rock.position.distanceTo(this.world.houseGroup.position);
                                    if (dHouse < 4.0) {
                                        // remove one or two parts to simulate destruction
                                        for (let rmi = 0; rmi < 1 + Math.floor(Math.random() * 2); rmi++) {
                                            if (this.world.houseGroup.children.length > 0) {
                                                try { const part = this.world.houseGroup.children.pop(); this.scene.remove(part); } catch(e){}
                                            }
                                        }
                                    }
                                }
                                // quick fade of rock
                                setTimeout(() => {
                                    try { this.scene.remove(rock); } catch(e){}
                                }, 4000 + Math.random() * 3000);
                            } catch (err) {}
                            // destroy the faller
                            try { faller.destroy(); } catch(e){ if (faller.mesh) try { this.scene.remove(faller.mesh); } catch(e){} }
                        }
                    };
                    this.enemies.push(faller);
                }

                // spawn aftershocks: smaller tremors that may drop more debris
                const aftershockCount = Math.max(2, Math.floor(2 * magnitude));
                for (let k = 0; k < aftershockCount; k++) {
                    setTimeout(() => {
                        this.triggerEarthquake(center, Math.max(0.4, magnitude * 0.6), 3000);
                    }, 1200 + Math.random() * 2200);
                }

                // announcement & sound
                if (this._announcementText) {
                    this._announcementText.textContent = 'EARTHQUAKE: Ground is shaking — falling enemies and debris!';
                    setTimeout(() => { if (this._announcementText) this._announcementText.textContent = 'UPDATES MORE SOON!'; }, 3000);
                }
                if (this.alertsEnabled) this.playSound('bomb');
            } catch (e) {
                console.warn('triggerEarthquake failed', e);
            }
        };

        this.animate = this.animate.bind(this);

        // Additional Halloween: ensure the jack-o-lantern exists when mode active
        try {
            if (this.halloweenMode && this.world && typeof this.world.setupJackOLantern === 'function') {
                this.world.setupJackOLantern();
            }
        } catch(e){}

        // small periodic listener already exists for many keys; we also need to ensure 'A' pickup state persists visually:
        // if holding a lantern, make it follow the player in animate loop (handled in updateGameState)
        requestAnimationFrame(this.animate);

        window.addEventListener('resize', () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        });

        // Keybind: G to spawn a temporary pet guard that protects nearby pets by seeking and destroying enemies
        window.addEventListener('keydown', (e) => {
            try {
                if (e.key.toLowerCase() !== 'g') return;
                // spawn a guard at player position
                const loader = new THREE.TextureLoader();
                const tex = loader.load('/channels4_profile (4).jpg');
                const mat = new THREE.SpriteMaterial({ map: tex, color: 0xffffff });
                const sprite = new THREE.Sprite(mat);
                sprite.scale.set(1.4, 1.4, 1);
                sprite.position.copy(this.player.mesh.position.clone().add(new THREE.Vector3(0,1.2,0)));
                this.scene.add(sprite);

                const guard = {
                    sprite,
                    alive: true,
                    baseY: sprite.position.y,
                    _rand: Math.random()*10,
                    // guard lasts for 22 seconds by default
                    expiresAt: Date.now() + 22000
                };
                this.petGuards.push(guard);

                // feedback
                if (this._announcementText) {
                    this._announcementText.textContent = 'Pet Guard deployed! It will protect pets for ~22s.';
                    setTimeout(() => { if (this._announcementText) this._announcementText.textContent = 'UPDATES MORE SOON!'; }, 2400);
                }
                if (this.alertsEnabled) this.playSound('plant');
            } catch (err) {
                console.warn('Failed to spawn pet guard', err);
            }
        });
    }

    async loadSounds() {
        const soundFiles = {
            plant: 'plant_sound.mp3',
            day: 'day_change.mp3',
            jelly: 'buckwheat-boyz-peanut-butter-jelly-time.mp3',
            // bomb blast sound (reusing plant sound as a short fx)
            bomb: 'plant_sound.mp3',
            // Christmas song (plays during event)
            christmas: 'christmas_song.mp3'
        };

        for (const [name, url] of Object.entries(soundFiles)) {
            try {
                const response = await fetch(url);
                const arrayBuffer = await response.arrayBuffer();
                this.sounds[name] = await this.audioContext.decodeAudioData(arrayBuffer);
            } catch (e) {
                console.error("Failed to load sound", name);
            }
        }
    }

    playSound(name) {
        if (!this.sounds[name]) return;
        // Ensure AudioContext is running (unlock on first gesture)
        if (this.audioContext.state === 'suspended') {
            this.audioContext.resume().catch(() => {});
        }

        // For the jelly song, keep a single looping source so it doesn't restart repeatedly
        if (name === 'jelly') {
            if (this.jellySource) return; // already playing
            const source = this.audioContext.createBufferSource();
            source.buffer = this.sounds[name];
            source.loop = true;
            source.connect(this.audioContext.destination);
            source.start(0);
            this.jellySource = source;
            return;
        }

        const source = this.audioContext.createBufferSource();
        source.buffer = this.sounds[name];
        source.connect(this.audioContext.destination);
        source.start(0);
    }

    stopJelly() {
        if (this.jellySource) {
            try {
                this.jellySource.stop(0);
            } catch (e) {}
            try { this.jellySource.disconnect(); } catch(e) {}
            this.jellySource = null;
        }
    }

    setupControls() {
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

        // Unlock audio on first user gesture to satisfy autoplay restrictions
        const unlockAudio = () => {
            if (this.audioContext && this.audioContext.state === 'suspended') {
                this.audioContext.resume().catch(() => {});
            }
            // remove listeners after first unlock
            window.removeEventListener('touchstart', unlockAudio);
            window.removeEventListener('mousedown', unlockAudio);
        };
        window.addEventListener('touchstart', unlockAudio, { once: true });
        window.addEventListener('mousedown', unlockAudio, { once: true });

        if (isMobile) {
            const joystick = nipplejs.create({
                zone: document.getElementById('mobile-controls'),
                mode: 'static',
                position: { left: '50px', bottom: '50px' },
                color: 'white'
            });

            joystick.on('move', (evt, data) => {
                this.input.x = data.vector.x;
                this.input.y = -data.vector.y;
                this.input.isDown = true;
            });

            joystick.on('end', () => {
                this.input.isDown = false;
            });
        } else {
            window.addEventListener('mousedown', () => this.input.isDown = true);
            window.addEventListener('mouseup', () => this.input.isDown = false);
            window.addEventListener('mousemove', (e) => {
                // Map mouse position to normalized screen space or world space movement
                // Simplified: follow cursor relative to screen center
                this.input.x = (e.clientX / window.innerWidth - 0.5) * 2;
                this.input.y = (e.clientY / window.innerHeight - 0.5) * 2;
            });
        }
    }

    setupParrotControls() {
        // UI elements
        const modeTextBtn = document.getElementById('parrot-mode-text');
        const modeVoiceBtn = document.getElementById('parrot-mode-voice');
        const actionBtn = document.getElementById('parrot-action');
        const stopBtn = document.getElementById('parrot-stop');
        const textInput = document.getElementById('parrot-text');
        const status = document.getElementById('parrot-status');

        this.parrotMode = 'text'; // or 'voice'
        modeTextBtn.addEventListener('click', () => {
            this.parrotMode = 'text';
            modeTextBtn.style.background = '#4CAF50';
            modeVoiceBtn.style.background = '#ddd';
            status.textContent = 'Text mode';
        });
        modeVoiceBtn.addEventListener('click', () => {
            this.parrotMode = 'voice';
            modeVoiceBtn.style.background = '#4CAF50';
            modeTextBtn.style.background = '#ddd';
            status.textContent = 'Voice mode';
        });

        // Microphone recorder
        this._mediaRecorder = null;
        this._recordedChunks = [];
        this._isRecording = false;

        actionBtn.addEventListener('click', async () => {
            const parrot = this.world.parrot;
            if (!parrot) return;

            // visual feedback
            parrot.material.color = new THREE.Color(0xffffff);
            parrot.velocity = 0.25;
            status.textContent = 'Working...';

            if (this.parrotMode === 'text') {
                const text = textInput.value || "Squawk!";
                // Use speechSynthesis for TTS
                const utter = new SpeechSynthesisUtterance(text);
                // ensure audio plays (audioContext resumed earlier on gesture)
                window.speechSynthesis.cancel();
                window.speechSynthesis.speak(utter);

                // bounce parrot while speaking
                parrot.isSpeaking = true;
                setTimeout(() => { parrot.isSpeaking = false; status.textContent = 'Idle'; }, Math.max(800, text.length * 60));
            } else {
                // Voice mode: start/stop recording on each press
                if (!this._isRecording) {
                    try {
                        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                        this._recordedChunks = [];
                        this._mediaRecorder = new MediaRecorder(stream);
                        this._mediaRecorder.ondataavailable = (e) => {
                            if (e.data.size > 0) this._recordedChunks.push(e.data);
                        };
                        this._mediaRecorder.onstop = () => {
                            const blob = new Blob(this._recordedChunks, { type: 'audio/webm' });
                            const url = URL.createObjectURL(blob);
                            const audio = new Audio(url);
                            audio.onended = () => { status.textContent = 'Idle'; parrot.isSpeaking = false; };
                            parrot.isSpeaking = true;
                            audio.play();
                        };
                        this._mediaRecorder.start();
                        this._isRecording = true;
                        status.textContent = 'Recording...';
                    } catch (e) {
                        console.error('Microphone access denied', e);
                        status.textContent = 'Mic denied';
                        parrot.velocity = 0;
                    }
                } else {
                    // stop
                    this._mediaRecorder.stop();
                    this._isRecording = false;
                    status.textContent = 'Playing...';
                }
            }
        });

        stopBtn.addEventListener('click', () => {
            // stop any playing TTS/recording
            if (this._isRecording && this._mediaRecorder) {
                this._mediaRecorder.stop();
                this._isRecording = false;
            }
            window.speechSynthesis.cancel();
            this.stopJelly();
            status.textContent = 'Idle';
        });
    }

    setupTeleportControls() {
        // Q to teleport — prompts destination
        window.addEventListener('keydown', (e) => {
            if (e.key.toLowerCase() !== 'q') return;
            // quick prompt for destination
            const dest = window.prompt("What do you want to teleport? (e.g. desert, foggy, dark, island)", "island");
            if (!dest) return;
            const d = dest.trim().toLowerCase();

            // DARK FOREST MODE (play as Builder G — find Capybara A)
            if (d === 'dark' || d === 'darkforest') {
                // move player to Builder G position and enter dark mode
                try {
                    if (this.world && this.world.builderG) {
                        // position player at Builder G to play as Builder G
                        this.player.mesh.position.copy(this.world.builderG.position);
                        if (this.world) this.world.playerPosition = this.player.mesh.position;
                        // subtle visual change: tint builderG
                        this.world.builderG.material.color.setHex(0xffffaa);
                    } else {
                        this.player.mesh.position.set(0, 0, 0);
                    }

                    // Dark forest visuals
                    this.scene.background = new THREE.Color(0x051019); // very dark blue-black
                    this.scene.fog = new THREE.FogExp2(0x051019, 0.06);
                } catch (err) { console.warn(err); }

                // UI / instructions: 30 seconds until infectors arrive
                const instr = document.getElementById('instructions');
                if (instr) {
                    instr.innerHTML = "DARK FOREST — Find Capybara A within 30s!<br>Use your flashlight (Q to teleport back if needed).";
                    instr.style.background = "rgba(0,0,0,0.75)";
                }

                // Setup dark mode game state
                this.gameState.darkMode = true;
                this.gameState.darkTimer = 30; // seconds until infectors spawn
                this.gameState.foundCapybara = false;

                // Spawn a Capybara A somewhere nearby (hidden in dark)
                this.spawnCapybaraA();

                // play subtle alert
                if (this.alertsEnabled) this.playSound('day');
                return;
            }

            // FOGGY SURVIVAL MODE
            if (d === 'foggy') {
                // move player into fog zone
                this.player.mesh.position.set(0, 0, 30);
                if (this.world) this.world.playerPosition = this.player.mesh.position;

                // heavy gray fog and muted sky
                try {
                    this.scene.background = new THREE.Color(0x9b9b9b); // gray sky
                    // stronger, low-visibility fog
                    this.scene.fog = new THREE.FogExp2(0x9b9b9b, 0.06);
                } catch (err) { console.warn(err); }

                // Emergency overlay/message specifically for Foggy map
                const overlay = document.getElementById('emergency-overlay');
                const messageEl = document.getElementById('emergency-message');
                if (overlay) {
                    if (messageEl) {
                        // Updated alert text per request
                        messageEl.textContent = "This is not a safe place — contact someone on your phone and explain why this area is unsafe.";
                    }
                    if (this.alertsEnabled) overlay.style.display = 'flex';
                    // auto-hide after 14 seconds (still ensure it's hidden even if alerts disabled)
                    setTimeout(() => {
                        try { overlay.style.display = 'none'; } catch(e){}
                    }, 14000);
                }
                // hook up overlay buttons
                const hideBtn = document.getElementById('emergency-hide');
                const skipBtn = document.getElementById('emergency-skip');
                if (hideBtn) hideBtn.onclick = () => { document.getElementById('emergency-overlay').style.display = 'none'; };
                if (skipBtn) skipBtn.onclick = () => { document.getElementById('emergency-overlay').style.display = 'none'; };

                // Disable pets but keep Builder G present so players can shelter and repair the map
                try {
                    this.gameState.pets = 0;
                    const petCounter = document.getElementById('pet-counter');
                    if (petCounter) petCounter.textContent = '0';
                    if (this.world.cashy) { this.scene.remove(this.world.cashy); this.world.cashy = null; }
                    if (this.world.dancingBanana) { this.scene.remove(this.world.dancingBanana); this.world.dancingBanana = null; }
                    // ensure builderG remains (do not remove)
                    if (!this.world.builderG) {
                        // attempt to recreate a minimal Builder G sprite if missing
                        try {
                            const textureLoader = new THREE.TextureLoader();
                            const gTex = textureLoader.load('/channels4_profile (4).jpg');
                            const material = new THREE.SpriteMaterial({ map: gTex });
                            this.world.builderG = new THREE.Sprite(material);
                            this.world.builderG.scale.set(2,2,1);
                            this.world.builderG.position.set(-5,1,3);
                            this.scene.add(this.world.builderG);
                            this.world.builderG.originalY = 1;
                            this.world.builderG.velocity = 0;
                        } catch(e){ console.warn('Could not recreate Builder G', e); }
                    }
                } catch (err) { console.warn(err); }

                // Force survival mode and make spawn aggressive
                this.gameState.isSurvival = true;
                this.enemySpawnThreshold = 0.8;
                this.enemySpawnTimer = 0;

                // Spawn an immediate heavy fog wave of enemies
                for (let i = 0; i < 18; i++) {
                    const angle = Math.random() * Math.PI * 2;
                    const r = 10 + Math.random() * 12;
                    const spawnPos = new THREE.Vector3(Math.cos(angle) * r, 0, Math.sin(angle) * r);
                    this.enemies.push(new Enemy(this.scene, spawnPos));
                }

                // Stop multiplayer access for this client (soft-disable UI feedback)
                try {
                    const peerCountEl = document.getElementById('peer-count');
                    if (peerCountEl) peerCountEl.textContent = '0';
                } catch (e) {}

                // update instructions bar to instruct player to stay by Builder G to repair/fix the map
                const instr = document.getElementById('instructions');
                if (instr) {
                    instr.innerHTML = "FOGGY SURVIVAL — THIS IS NOT SAFE.<br>Stay by Builder G to help fix the map and secure shelter.";
                    instr.style.background = "rgba(0,0,0,0.7)";
                }

                // play alert sound
                this.playSound('day');
                return;
            }

            // CASTLE MAP — teleport into castle town and prepare the King Infectors siege
            if (d === 'castle' || d === 'castle map' || d === 'castle-town') {
                try {
                    // Move player to castle plaza coordinates
                    this.player.mesh.position.set(22, 0, -8);
                    if (this.world) this.world.playerPosition = this.player.mesh.position;

                    // Castle visuals: dusky sky, heavier fog for drama
                    this.scene.background = new THREE.Color(0x2b2f3a);
                    this.scene.fog = new THREE.FogExp2(0x2b2f3a, 0.035);

                    // Add a simple castle silhouette near the player if not present
                    if (!this._castleGroup) {
                        const castle = new THREE.Group();
                        const wallMat = new THREE.MeshStandardMaterial({ color: 0x6b5b4a });
                        const towerMat = new THREE.MeshStandardMaterial({ color: 0x4a3b31 });
                        // main keep
                        const keep = new THREE.Mesh(new THREE.BoxGeometry(8, 4, 6), wallMat);
                        keep.position.set(24, 2, -10);
                        castle.add(keep);
                        // two towers
                        const t1 = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.4, 5, 8), towerMat);
                        t1.position.set(20.5, 2.5, -7);
                        const t2 = t1.clone();
                        t2.position.set(27.5, 2.5, -7);
                        castle.add(t1, t2);
                        // flag sprite (use existing icon as banner)
                        try {
                            const tex = new THREE.TextureLoader().load('/channels4_profile (4).jpg');
                            const flag = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex }));
                            flag.scale.set(1.6, 0.9, 1);
                            flag.position.set(24, 4.5, -10);
                            castle.add(flag);
                        } catch (e) {}
                        this._castleGroup = castle;
                        this.scene.add(this._castleGroup);
                    }

                    // Instructions for castle
                    const instr = document.getElementById('instructions');
                    if (instr) {
                        instr.innerHTML = "CASTLE TOWN — The King Infectors Dede is approaching!<br>Stand near Builder G to activate the G-Defense.";
                        instr.style.background = "rgba(80,10,10,0.7)";
                    }

                    // Brief delay then spawn the castle siege (uses existing spawnCastleInfectors)
                    setTimeout(() => {
                        try {
                            this.spawnCastleInfectors(28);
                        } catch (e) {
                            console.warn('spawnCastleInfectors error', e);
                        }
                    }, 1200);

                    // Play dramatic alert chime
                    if (this.alertsEnabled) this.playSound('day');
                } catch (err) {
                    console.warn('Castle teleport failed', err);
                }
                return;
            }

            // RED MAP — quiz-gated "raining capybara" entry with Square Red White NPC (10-question weather quiz)
            if (d === 'red' || d === 'red map') {
                try {
                    const texLoader = new THREE.TextureLoader();
                    const redTex = texLoader.load('/Square_red_white.webp');
                    const gate = new THREE.Sprite(new THREE.SpriteMaterial({ map: redTex, transparent: true }));
                    gate.scale.set(2.2, 2.2, 1);
                    gate.position.copy(this.player.mesh.position.clone().add(new THREE.Vector3(0, 2.4, 0)));
                    gate.userData.isGate = true;
                    this.scene.add(gate);

                    const prevAnn = this._announcementText ? this._announcementText.textContent : '';
                    if (this._announcementText) this._announcementText.textContent = "Square: Answer 10 weather science questions to enter the Red map!";

                    // Define 10 weather science multiple-choice questions
                    const questions = [
                        { q: "What causes rain to form in the atmosphere?", choices: { A: "Cold air rising and condensing", B: "Warm air rising, cooling, and condensing", C: "Wind blowing from oceans" }, correct: "B" },
                        { q: "Which term describes liquid water falling from clouds?", choices: { A: "Evaporation", B: "Condensation", C: "Precipitation" }, correct: "C" },
                        { q: "What instrument measures atmospheric pressure?", choices: { A: "Thermometer", B: "Barometer", C: "Anemometer" }, correct: "B" },
                        { q: "Which process turns water vapor into liquid droplets?", choices: { A: "Condensation", B: "Sublimation", C: "Transpiration" }, correct: "A" },
                        { q: "What drives large-scale weather patterns on Earth?", choices: { A: "Ocean currents and Earth's rotation", B: "Underground magma", C: "Tidal forces only" }, correct: "A" },
                        { q: "Which layer of the atmosphere contains most weather phenomena?", choices: { A: "Stratosphere", B: "Troposphere", C: "Mesosphere" }, correct: "B" },
                        { q: "What does an anemometer measure?", choices: { A: "Humidity", B: "Wind speed", C: "Cloud cover" }, correct: "B" },
                        { q: "What is relative humidity?", choices: { A: "Amount of water vapor relative to maximum at that temperature", B: "Total rainfall in a day", C: "Temperature difference between day and night" }, correct: "A" },
                        { q: "Which cloud type is commonly associated with heavy rain or storms?", choices: { A: "Cumulonimbus", B: "Cirrus", C: "Stratus" }, correct: "A" },
                        { q: "What causes fog to form near the ground?", choices: { A: "Air cooling to its dew point near the surface", B: "Strong surface winds", C: "High atmospheric pressure only" }, correct: "A" }
                    ];

                    // Ask each question in sequence using prompt, count correct answers
                    let correctCount = 0;
                    for (let i = 0; i < questions.length; i++) {
                        const item = questions[i];
                        const promptText = `Question ${i+1}/10:\n${item.q}\nA) ${item.choices.A}\nB) ${item.choices.B}\nC) ${item.choices.C}\n(Type A, B, or C)`;
                        const ans = window.prompt(promptText, 'A');
                        if (!ans) {
                            // treat empty/cancel as wrong
                            continue;
                        }
                        const res = String(ans).trim().toUpperCase();
                        if (res === item.correct) correctCount++;
                    }

                    // Determine pass threshold (e.g., 7/10)
                    const passThreshold = 7;
                    if (correctCount >= passThreshold) {
                        if (this._announcementText) this._announcementText.textContent = `You scored ${correctCount}/10 — Passed! Entering the Red map...`;
                        // Teleport to Red map and spawn rain visual
                        this.player.mesh.position.set(12, 0, -22);
                        if (this.world) this.world.playerPosition = this.player.mesh.position;
                        this.scene.background = new THREE.Color(0x5a1010);
                        this.scene.fog = new THREE.FogExp2(0x5a1010, 0.04);

                        const dropTex = new THREE.TextureLoader().load('/Diamond.png');
                        this._redRain = this._redRain || [];
                        for (let i = 0; i < 60; i++) {
                            const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: dropTex, color: 0x88ddff, transparent: true }));
                            spr.scale.set(0.15 + Math.random() * 0.25, 0.5 + Math.random() * 0.6, 1);
                            spr.position.set(this.player.mesh.position.x + (Math.random() - 0.5) * 30, 8 + Math.random() * 6, this.player.mesh.position.z + (Math.random() - 0.5) * 30);
                            spr.userData.vy = 4 + Math.random() * 6;
                            this.scene.add(spr);
                            this._redRain.push(spr);
                        }
                        if (!this._redRainTickAttached) {
                            this._redRainTickAttached = true;
                            const gameRef = this;
                            const rainTick = () => {
                                if (!gameRef._redRain) return;
                                for (const r of gameRef._redRain) {
                                    r.position.y -= (r.userData.vy || 5) * 0.016;
                                    if (r.position.y < 0.2) {
                                        r.position.y = 8 + Math.random() * 6;
                                        r.position.x = gameRef.player.mesh.position.x + (Math.random() - 0.5) * 30;
                                        r.position.z = gameRef.player.mesh.position.z + (Math.random() - 0.5) * 30;
                                    }
                                }
                                if (gameRef._redRain && gameRef._redRain.length) requestAnimationFrame(rainTick);
                            };
                            rainTick();
                        }
                        setTimeout(() => { try { this.scene.remove(gate); } catch(e){} }, 1600);
                    } else {
                        if (this._announcementText) this._announcementText.textContent = `You scored ${correctCount}/10 — Failed (need ${passThreshold}/10). Try again later.`;
                        setTimeout(() => { if (this._announcementText) this._announcementText.textContent = prevAnn || 'UPDATES MORE SOON!'; }, 3000);
                        setTimeout(() => { try { this.scene.remove(gate); } catch(e){} }, 1200);
                    }
                } catch (err) {
                    console.warn('Red teleport/quiz failed', err);
                }
                return;
            }

            // ISLAND MAP (shark army incoming)
            if (d === 'island') {
                try {
                    // Move player to island coordinates
                    this.player.mesh.position.set(-40, 0, -20);
                    if (this.world) this.world.playerPosition = this.player.mesh.position;

                    // Island visuals: deep sea horizon and light fog
                    this.scene.background = new THREE.Color(0x88cfe6);
                    this.scene.fog = new THREE.FogExp2(0x88cfe6, 0.01);

                    // Create a small water plane near the player to suggest shoreline (non-destructive)
                    if (!this._islandWater) {
                        const waterMat = new THREE.MeshStandardMaterial({ color: 0x2E9FFF, transparent: true, opacity: 0.85 });
                        const water = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), waterMat);
                        water.rotation.x = -Math.PI / 2;
                        water.position.set(-40, 0.02, -20);
                        this._islandWater = water;
                        this.scene.add(this._islandWater);
                    }

                    // Spawn a friendly boat NPC near the shore
                    if (!this._friendBoat) {
                        const texLoader = new THREE.TextureLoader();
                        // simple placeholder: reuse channels4_profile as boat flag / sprite
                        const boatTex = texLoader.load('/channels4_profile (4).jpg');
                        const mat = new THREE.SpriteMaterial({ map: boatTex, transparent: true });
                        const boat = new THREE.Sprite(mat);
                        boat.scale.set(3, 1.6, 1);
                        boat.position.set(-38, 0.6, -18);
                        boat.userData.isFriend = true;
                        boat.name = 'friendBoat';
                        this.scene.add(boat);
                        this._friendBoat = boat;
                    }

                    // Instruction UI
                    const instr = document.getElementById('instructions');
                    if (instr) {
                        instr.innerHTML = "ISLAND — You're safe for now; sharks are approaching from the deep!<br>Stay on the island or shelter in the boat.";
                        instr.style.background = "rgba(0,0,0,0.45)";
                    }

                    // Spawn a shark army after a short delay (gives the "before sharks" moment)
                    setTimeout(() => {
                        if (!this._sharkSpawning) {
                            this._sharkSpawning = true;
                            this.spawnSharkArmy(8); // spawn 8 sharks
                        }
                    }, 7000);

                    // Play subtle sea chime
                    if (this.alertsEnabled) this.playSound('day');
                } catch (err) {
                    console.warn('Island teleport failed', err);
                }
                return;
            }

            // existing desert behavior
            if (d === 'desert') {
                // Move player to desert area
                this.player.mesh.position.set(30, 0, 0);
                if (this.world) this.world.playerPosition = this.player.mesh.position;
                // Change sky / fog to deserty color and thicker fog
                try {
                    this.scene.background = new THREE.Color(0xEED9A6); // sandy sky
                    this.scene.fog = new THREE.FogExp2(0xEED9A6, 0.02);
                } catch (err) { console.warn(err); }
                // Show alert/instructions
                const instr = document.getElementById('instructions');
                if (instr) {
                    instr.innerHTML = "ALERT: ENEMY ARMY IN DESERT!<br>Defend or teleport back.";
                    instr.style.background = "rgba(255,80,80,0.85)";
                }

                // Show Emergency Overlay with warning icon and message
                const overlay2 = document.getElementById('emergency-overlay');
                const messageEl2 = document.getElementById('emergency-message');
                if (overlay2) {
                    // set the message explicitly from the request
                    if (messageEl2) {
                        messageEl2.textContent = "This is an Emergency Alert: You must not go into the desert — a lot of enemies will come. Stay indoors and stop The Evil enemies!!!!";
                    }
                    if (this.alertsEnabled) overlay2.style.display = 'flex';
                    // auto-hide after 12 seconds
                    setTimeout(() => {
                        try { overlay2.style.display = 'none'; } catch(e){}
                    }, 12000);
                }
                // hook up overlay buttons if present
                const hideBtn = document.getElementById('emergency-hide');
                const skipBtn = document.getElementById('emergency-skip');
                if (hideBtn) hideBtn.onclick = () => { document.getElementById('emergency-overlay').style.display = 'none'; };
                if (skipBtn) skipBtn.onclick = () => { document.getElementById('emergency-overlay').style.display = 'none'; };

                // Increase spawn aggressiveness and immediately spawn an army
                this.enemySpawnThreshold = 1.0; // faster spawns
                this.enemySpawnTimer = 0;
                // spawn immediate wave
                for (let i = 0; i < 10; i++) {
                    const angle = Math.random() * Math.PI * 2;
                    const r = 18 + Math.random() * 6;
                    const spawnPos = new THREE.Vector3(Math.cos(angle) * r, 0, Math.sin(angle) * r);
                    this.enemies.push(new Enemy(this.scene, spawnPos));
                }
                // Play an alert sound if available
                if (this.alertsEnabled) this.playSound('day');
            } else {
                // default: teleport to center / reset sky
                this.player.mesh.position.set(0, 0, 0);
                if (this.world) this.world.playerPosition = this.player.mesh.position;
                try {
                    this.scene.background = new THREE.Color(0x87CEEB);
                    this.scene.fog = new THREE.Fog(0x87CEEB, 20, 50);
                } catch (err) {}
                const instr = document.getElementById('instructions');
                if (instr) {
                    instr.innerHTML = "Teleported back.";
                    instr.style.background = "rgba(0,0,0,0.4)";
                }
                this.enemySpawnThreshold = 3;
            }
        });
    }

    updateGameState(dt) {
        if (this.gameState.gameOver) return;

        // --- Daily challenge timer (unchanged)
        if (this.gameState.challengeSeconds > 0) {
            this.gameState.challengeSeconds -= dt;
            if (this.gameState.challengeSeconds < 0) this.gameState.challengeSeconds = 0;
        }
        const secs = Math.ceil(this.gameState.challengeSeconds);
        const h = String(Math.floor(secs / 3600)).padStart(2, '0');
        const m = String(Math.floor((secs % 3600) / 60)).padStart(2, '0');
        const s = String(secs % 60).padStart(2, '0');
        if (this._challengeTimerEl) this._challengeTimerEl.textContent = (secs > 0 ? `Starts in: ${h}:${m}:${s}` : 'Ready to claim');

        if (this._claimBtn) {
            if (secs === 0) {
                this._claimBtn.disabled = false;
                this._claimBtn.style.background = '#FFD700';
            } else {
                this._claimBtn.disabled = true;
                this._claimBtn.style.background = '#bdbdbd';
            }
        }

        const pPos = this.player.mesh.position;

        // --- Bush stay detection: if player stays near any vegetation item for _bushStayRequired seconds, allow special spawn
        try {
            let nearBush = false;
            if (this.world && Array.isArray(this.world._vegetationItems)) {
                for (const item of this.world._vegetationItems) {
                    if (!item || !item.position) continue;
                    const d = pPos.distanceTo(item.position);
                    if (d < 1.4) { nearBush = true; break; }
                }
            }
            if (nearBush) {
                this._bushStayTimer += dt;
                if (this._bushStayTimer >= this._bushStayRequired) {
                    if (!this._canSpawnInfectorsDede) {
                        this._canSpawnInfectorsDede = true;
                        if (this._announcementText) {
                            this._announcementText.textContent = "You can now run command: spawn_infectorsdede (call window.spawnInfectorsDede())";
                            setTimeout(() => { this._announcementText.textContent = 'UPDATES MORE SOON!'; }, 4000);
                        }
                    }
                }
            } else {
                this._bushStayTimer = 0;
                if (this._canSpawnInfectorsDede && !this._infectorsDedeSpawned) {
                    // if player leaves before using the command, disallow again
                    this._canSpawnInfectorsDede = false;
                }
            }
        } catch (e) {
            // swallow errors to avoid breaking update loop
        }

        // --- DARK FOREST mode handling ---
        if (this.gameState.darkMode) {
            // countdown until infectors arrive
            if (this.gameState.darkTimer > 0 && !this.gameState.foundCapybara) {
                this.gameState.darkTimer -= dt;
                const dtSec = Math.ceil(this.gameState.darkTimer);
                const instr = document.getElementById('instructions');
                if (instr) instr.innerHTML = `DARK FOREST — Find Capybara A within ${dtSec}s!`;
                // small flashlight hint: if player near capybara, make it slightly visible
                if (this.world.darkCapybara) {
                    const dist = pPos.distanceTo(this.world.darkCapybara.position);
                    const alpha = Math.max(0.08, Math.min(1, 1 - dist / 15));
                    try { this.world.darkCapybara.material.opacity = alpha; } catch(e){}
                }
            }

            // Win check: player found Capybara A before infectors arrive
            if (this.world.darkCapybara && !this.gameState.foundCapybara) {
                const foundDist = pPos.distanceTo(this.world.darkCapybara.position);
                if (foundDist < 2.0) {
                    this.gameState.foundCapybara = true;
                    // success: teleport back to ground (reset scene visuals)
                    try {
                        this.scene.background = new THREE.Color(0x87CEEB);
                        this.scene.fog = new THREE.Fog(0x87CEEB, 20, 50);
                    } catch (e) {}
                    const instr = document.getElementById('instructions');
                    if (instr) {
                        instr.innerHTML = "YOU FOUND CAPYBARA A — Returning to ground!";
                        instr.style.background = "rgba(0,128,0,0.7)";
                    }
                    // award a point and remove capybara
                    this.gameState.points = (this.gameState.points || 0) + 1;
                    if (this._pointsEl) this._pointsEl.textContent = this.gameState.points;
                    try { this.scene.remove(this.world.darkCapybara); } catch(e){}
                    this.world.darkCapybara = null;
                    // clear dark mode flags and teleport player to center ground
                    this.gameState.darkMode = false;
                    setTimeout(() => {
                        this.player.mesh.position.set(0, 0, 0);
                        if (this.world) this.world.playerPosition = this.player.mesh.position;
                    }, 800);
                    return;
                }
            }

            // If timer expired and capybara not found -> spawn infectors and enter survival
            if (this.gameState.darkTimer <= 0 && !this.gameState.infectorsSpawned) {
                this.gameState.infectorsSpawned = true;
                this.gameState.isSurvival = true;
                this.enemySpawnTimer = 0;
                this.enemySpawnThreshold = 0.6;
                // spawn a wave of infectors around player
                for (let i = 0; i < 16; i++) {
                    const angle = Math.random() * Math.PI * 2;
                    const r = 8 + Math.random() * 10;
                    const spawnPos = new THREE.Vector3(pPos.x + Math.cos(angle) * r, 0, pPos.z + Math.sin(angle) * r);
                    this.enemies.push(new Enemy(this.scene, spawnPos));
                }
                // show overlay warning
                const overlay = document.getElementById('emergency-overlay');
                const messageEl = document.getElementById('emergency-message');
                if (messageEl) messageEl.textContent = "INFECTORS HAVE ARRIVED — Survive or be captured!";
                if (overlay) {
                    if (this.alertsEnabled) overlay.style.display = 'flex';
                    setTimeout(() => { try { overlay.style.display = 'none'; } catch(e){} }, 9000);
                }
                if (this.alertsEnabled) this.playSound('day');
            }
        }

        // --- Normal day progression & survival (unchanged but integrated) ---
        // Check for interaction with Time G (videoframe_1086.png)
        const timeGDist = pPos.distanceTo(this.world.timeG.position);
        let timeMultiplier = 1;
        if (timeGDist < 2.5) {
            timeMultiplier = 5;
            this.world.timeG.material.color.setHex(0xffccff);
            if (Math.random() > 0.9) this.world.timeG.bounce();
        } else {
            this.world.timeG.material.color.setHex(0xffffff);
        }

        if (!this.gameState.isSurvival) {
            this.gameState.timer += dt * timeMultiplier;
            if (this.gameState.timer >= this.gameState.dayDuration) {
                this.gameState.timer = 0;
                if (this.gameState.day < this.gameState.maxDays) {
                    this.gameState.day++;
                    document.getElementById('day-counter').textContent = this.gameState.day;
                    this.playSound('day');
                    this.world.advanceGrowth(this.gameState.day);
                    this.world.advanceHouse(this.gameState.day);

                    const plantStages = ["Seed", "Sprout", "Sapling", "Bush", "Tree", "Fruiting Tree", "Majestic Tree"];
                    const houseStages = ["Blueprint", "Foundation", "Framework", "Walls", "Roofing", "Finishing", "Completed!"];
                    document.getElementById('plant-stage').textContent = plantStages[this.gameState.day - 1];
                    document.getElementById('house-stage').textContent = houseStages[this.gameState.day - 1];
                } else {
                    this.gameState.isSurvival = true;
                    document.getElementById('instructions').innerHTML = "ENEMIES APPROACHING!<br>Stand near Builder G to activate defenses!";
                    document.getElementById('instructions').style.background = "rgba(255,0,0,0.6)";
                }
            }
        } else {
            // Survival logic
            this.enemySpawnTimer += dt;
            if (this.enemySpawnTimer > (this.enemySpawnThreshold || 3)) {
                this.enemySpawnTimer = 0;
                const angle = Math.random() * Math.PI * 2;
                const spawnPos = new THREE.Vector3(Math.cos(angle) * 20, 0, Math.sin(angle) * 20);
                this.enemies.push(new Enemy(this.scene, spawnPos));
            }

            // Move enemies and check capture of capybara/pets
            this.enemies.forEach(enemy => {
                if (!enemy.alive) return;
                // if capybara target exists, they go for it; otherwise go for Cashy if present
                const targetPos = (this.world && this.world.cashy) ? this.world.cashy.position : this.player.mesh.position;
                enemy.update(targetPos, dt);

                // If targeting a pet that is currently protected by a lantern, destroy the enemy instead of capture
                try {
                    const petsToCheck = ['cashy','builderG','dancingBanana'];
                    for (const key of petsToCheck) {
                        const pet = this.world[key];
                        if (!pet || !pet.position) continue;
                        const d = enemy.mesh.position.distanceTo(pet.position);
                        if (d < 1.2) {
                            const prot = pet.userData && pet.userData.protectedUntil ? pet.userData.protectedUntil : 0;
                            if (prot && Date.now() < prot) {
                                // enemy blocked and dies (after blocking moment we can show quick feedback)
                                try { enemy.destroy(); } catch(e){ if (enemy.mesh) try { this.scene.remove(enemy.mesh); } catch(e){} }
                                if (this._announcementText) {
                                    this._announcementText.textContent = "Infectors died defending the pet!";
                                    setTimeout(() => { if (this._announcementText) this._announcementText.textContent = 'UPDATES MORE SOON!'; }, 2000);
                                }
                                if (this.alertsEnabled) this.playSound('bomb');
                                // continue to next enemy
                                continue;
                            } else {
                                // not protected -> normal capture
                                if (key === 'cashy') {
                                    this.gameState.gameOver = true;
                                    document.getElementById('instructions').innerHTML = "GAME OVER<br>Cashy was captured! Refresh to restart.";
                                }
                            }
                        }
                    }
                } catch (e) {
                    // fallback: original cashy capture behaviour
                    if (this.world && this.world.cashy) {
                        const distToCashy = enemy.mesh.position.distanceTo(this.world.cashy.position);
                        if (distToCashy < 1) {
                            this.gameState.gameOver = true;
                            document.getElementById('instructions').innerHTML = "GAME OVER<br>Cashy was captured! Refresh to restart.";
                        }
                    }
                }
            });

            // Pet guard logic: each guard seeks the nearest alive enemy within range and destroys it
            try {
                if (this.petGuards && this.petGuards.length) {
                    for (let i = this.petGuards.length - 1; i >= 0; i--) {
                        const guard = this.petGuards[i];
                        if (!guard || !guard.alive) {
                            // cleanup
                            try { this.scene.remove(guard.sprite); } catch(e){}
                            this.petGuards.splice(i, 1);
                            continue;
                        }
                        // find nearest enemy within search radius
                        let nearest = null;
                        let nearestD = Infinity;
                        for (const en of this.enemies) {
                            if (!en || !en.alive || !en.mesh) continue;
                            const d = guard.sprite.position.distanceTo(en.mesh.position);
                            if (d < nearestD) { nearestD = d; nearest = en; }
                        }
                        // move guard slightly toward nearest enemy (or patrol around pets)
                        const speed = 6.0;
                        if (nearest && nearestD < 18) {
                            const dir = new THREE.Vector3().subVectors(nearest.mesh.position, guard.sprite.position);
                            dir.y = 0;
                            if (dir.length() > 0.2) {
                                dir.normalize();
                                guard.sprite.position.add(dir.multiplyScalar(speed * dt));
                            }
                            // if close enough, destroy the enemy
                            if (nearestD < 1.6) {
                                try { nearest.destroy(); } catch(e){ if (nearest.mesh) try { this.scene.remove(nearest.mesh); } catch(e){} }
                                // small visual flash
                                try {
                                    const p = guard.sprite.position.clone();
                                    const mat = new THREE.MeshStandardMaterial({ color: 0xffcc66, emissive: 0xff6633 });
                                    const sph = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), mat);
                                    sph.position.copy(p);
                                    this.scene.add(sph);
                                    setTimeout(() => { try { this.scene.remove(sph); } catch(e){} }, 260);
                                } catch(e){}
                            }
                        } else {
                            // patrol near closest protected pet (if any), else hover near player
                            let patrolTarget = this.player.mesh.position;
                            const pets = ['cashy','builderG','dancingBanana'];
                            for (const key of pets) {
                                try {
                                    const pet = this.world[key];
                                    if (pet && pet.position) { patrolTarget = pet.position; break; }
                                } catch(e){}
                            }
                            const dir = new THREE.Vector3().subVectors(patrolTarget.clone().add(new THREE.Vector3(0,1.5,0)), guard.sprite.position);
                            dir.y = 0;
                            if (dir.length() > 0.3) {
                                dir.normalize();
                                guard.sprite.position.add(dir.multiplyScalar((speed*0.6) * dt));
                            }
                            // small bob
                            guard.sprite.position.y = guard.baseY + Math.abs(Math.sin(Date.now()*0.008 + guard._rand)) * 0.25;
                        }
                        // lifetime expiry
                        if (guard.expiresAt && Date.now() > guard.expiresAt) {
                            guard.alive = false;
                        }
                    }
                }
            } catch (e) {
                // guard update errors should not break main loop
                console.warn('Pet guard update error', e);
            }

            // G-Defense logic (unchanged)
            const distToG = pPos.distanceTo(this.world.builderG.position);
            if (distToG < 2.5) {
                this.world.builderG.material.color.setHex(0x00ffff);
                const target = this.enemies.find(e => e.alive && e.mesh.position.distanceTo(this.world.builderG.position) < 10);
                if (target) {
                    this.world.showGBeam(target.mesh.position);
                    target.destroy();
                    this.playSound('plant');
                }
            } else {
                this.world.builderG.material.color.setHex(0xffffff);
            }
        }

        // --- Interactions (cashy, builderG, banana) remain — update references safely ---
        if (this.world.cashy) {
            const cashyDist = pPos.distanceTo(this.world.cashy.position);
            if (cashyDist < 1.5 && !this.world.cashy.isPetting) {
                this.world.cashy.isPetting = true;
                this.gameState.pets++;
                document.getElementById('pet-counter').textContent = this.gameState.pets;
                this.playSound('pet');
                this.world.cashy.bounce();
                setTimeout(() => { this.world.cashy.isPetting = false; }, 1000);
            }
            // clear visual tint after protection expires
            try {
                const pet = this.world.cashy;
                if (pet.userData && pet.userData.protectedUntil && Date.now() > pet.userData.protectedUntil) {
                    pet.userData.protectedUntil = 0;
                    try { if (pet.material && pet.material.color) pet.material.color.setHex(0xffffff); } catch(e){}
                }
            } catch(e){}
        }

        // Chromebook Guy pet interaction (does not play the pet sound)
        if (this.world.chromebookGuy) {
            try {
                const cbDist = pPos.distanceTo(this.world.chromebookGuy.position);
                if (cbDist < 1.5 && !this.world.chromebookGuy.isPetting) {
                    this.world.chromebookGuy.isPetting = true;
                    this.gameState.pets++;
                    document.getElementById('pet-counter').textContent = this.gameState.pets;
                    // Intentionally do NOT call this.playSound('pet') for Chromebook Guy
                    try { this.world.chromebookGuy.bounce && this.world.chromebookGuy.bounce(); } catch(e){}
                    setTimeout(() => { this.world.chromebookGuy.isPetting = false; }, 1000);
                }
                // clear visual tint after protection expires if used
                const pet = this.world.chromebookGuy;
                if (pet.userData && pet.userData.protectedUntil && Date.now() > pet.userData.protectedUntil) {
                    pet.userData.protectedUntil = 0;
                    try { if (pet.material && pet.material.color) pet.material.color.setHex(0xffffff); } catch(e){}
                }
            } catch (e) {
                // swallow errors
            }
        }

        if (this.world.builderG) {
            const builderDist = pPos.distanceTo(this.world.builderG.position);
            if (builderDist < 1.5 && !this.world.builderG.isPetting) {
                this.world.builderG.isPetting = true;
                this.gameState.pets++;
                document.getElementById('pet-counter').textContent = this.gameState.pets;
                this.playSound('pet');
                this.world.builderG.bounce();
                setTimeout(() => { this.world.builderG.isPetting = false; }, 1000);
            }
            try {
                const pet = this.world.builderG;
                if (pet.userData && pet.userData.protectedUntil && Date.now() > pet.userData.protectedUntil) {
                    pet.userData.protectedUntil = 0;
                    try { if (pet.material && pet.material.color) pet.material.color.setHex(0xffffff); } catch(e){}
                }
            } catch(e){}
        }

        if (this.world.dancingBanana) {
            const bananaDist = pPos.distanceTo(this.world.dancingBanana.position);
            if (bananaDist < 1.5 && !this._bananaTouchCooldown) {
                this._bananaTouchCooldown = true;
                setTimeout(() => { this._bananaTouchCooldown = false; }, 600);

                if (!this.jellySource) {
                    this.playSound('jelly');
                    this.world.dancingBanana.material.color.setHex(0xffffff);
                    this.world.dancingBanana.bounce();
                    this.world.dancingBanana.following = true;
                    this.gameState.bananaTouched = true;
                } else {
                    this.stopJelly();
                    this.world.dancingBanana.material.color.setHex(0xaaaaaa);
                    this.world.dancingBanana.bounce();
                    this.gameState.bananaTouched = false;
                }
            }
            try {
                const pet = this.world.dancingBanana;
                if (pet.userData && pet.userData.protectedUntil && Date.now() > pet.userData.protectedUntil) {
                    pet.userData.protectedUntil = 0;
                    try { if (pet.material && pet.material.color) pet.material.color.setHex(0xffffff); } catch(e){}
                }
            } catch(e){}
        }

        if (this.world.builderG) {
            const builderDist = pPos.distanceTo(this.world.builderG.position);
            if (builderDist < 1.5 && !this.world.builderG.isPetting) {
                this.world.builderG.isPetting = true;
                this.gameState.pets++;
                document.getElementById('pet-counter').textContent = this.gameState.pets;
                this.playSound('pet');
                this.world.builderG.bounce();
                setTimeout(() => { this.world.builderG.isPetting = false; }, 1000);
            }
        }

        if (this.world.dancingBanana) {
            const bananaDist = pPos.distanceTo(this.world.dancingBanana.position);
            if (bananaDist < 1.5 && !this._bananaTouchCooldown) {
                this._bananaTouchCooldown = true;
                setTimeout(() => { this._bananaTouchCooldown = false; }, 600);

                if (!this.jellySource) {
                    this.playSound('jelly');
                    this.world.dancingBanana.material.color.setHex(0xffffff);
                    this.world.dancingBanana.bounce();
                    this.world.dancingBanana.following = true;
                    this.gameState.bananaTouched = true;
                } else {
                    this.stopJelly();
                    this.world.dancingBanana.material.color.setHex(0xaaaaaa);
                    this.world.dancingBanana.bounce();
                    this.gameState.bananaTouched = false;
                }
            }
        }
    }

    animate() {
        requestAnimationFrame(this.animate);

        // If paused, still render a frame but skip updates
        if (this.paused) {
            try {
                this.renderer.render(this.scene, this.camera);
            } catch (e) {}
            return;
        }

        const dt = 0.016; // Approx 60fps

        this.player.update(this.input, dt);
        this.world.update(dt);
        this.updateGameState(dt);

        // Update peer sprites from multiplayer presence (if initialized)
        try {
            if (this.room && this.room.presence && this.peerSprites) {
                const presence = this.room.presence;
                Object.entries(this.peerSprites).forEach(([clientId, sprite]) => {
                    // presence structure per client is expected to include x,y,z or a position object
                    const p = presence[clientId];
                    if (p) {
                        // support presence { x, y, z } or { position: { x,y,z } }
                        const px = (p.x !== undefined) ? p.x : (p.position && p.position.x) ? p.position.x : sprite.position.x;
                        const py = (p.y !== undefined) ? p.y : (p.position && p.position.y) ? p.position.y : sprite.position.y;
                        const pz = (p.z !== undefined) ? p.z : (p.position && p.position.z) ? p.position.z : sprite.position.z;
                        // lerp for smoothness
                        sprite.position.lerp(new THREE.Vector3(px, py || 1.2, pz), 0.25);
                    } else {
                        // if no presence info, gently return to default near origin
                        sprite.position.lerp(new THREE.Vector3(0, 1.2, 0), 0.05);
                    }
                });
            }
        } catch (e) {
            // ignore multiplayer update errors
        }

        // refresh debug overlay if visible
        if (this._debugVisible && this._updateDebugInfo) this._updateDebugInfo();

        // Smooth camera follow
        const targetCamPos = this.player.mesh.position.clone().add(new THREE.Vector3(0, 12, 12));
        this.camera.position.lerp(targetCamPos, 0.1);
        this.camera.lookAt(this.player.mesh.position);

        this.renderer.render(this.scene, this.camera);
    }

    // spawn a temporary diamond sprite as visual feedback
    spawnDiamondAt(position) {
        const loader = new THREE.TextureLoader();
        const tex = loader.load('/Diamond.png');
        const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
        const sprite = new THREE.Sprite(mat);
        sprite.scale.set(1.2, 1.2, 1);
        sprite.position.copy(position);
        this.scene.add(sprite);
        // float up then remove
        const start = Date.now();
        const dur = 1500;
        const tick = () => {
            const t = (Date.now() - start) / dur;
            if (t >= 1) {
                try { this.scene.remove(sprite); } catch(e){}
                return;
            }
            sprite.position.y += 0.015;
            requestAnimationFrame(tick);
        };
        tick();
    }

    // Throw a bomb from player position that damages nearby enemies
    throwBomb() {
        try {
            const origin = this.player.mesh.position.clone();
            // visual: expanding sphere
            const mat = new THREE.MeshStandardMaterial({ color: 0xff7744, transparent: true, opacity: 0.9, emissive: 0xff6633 });
            const geom = new THREE.SphereGeometry(0.2, 12, 8);
            const sphere = new THREE.Mesh(geom, mat);
            sphere.position.copy(origin);
            sphere.position.y = 0.8;
            this.scene.add(sphere);

            // play bomb sound
            this.playSound('bomb');

            // explosion animation parameters
            const start = Date.now();
            const dur = 600; // ms
            const maxRadius = 6.0;

            const tick = () => {
                const t = (Date.now() - start) / dur;
                const eased = Math.min(1, t);
                const scale = 0.2 + eased * maxRadius;
                sphere.scale.setScalar(scale);

                // fade out
                sphere.material.opacity = Math.max(0, 0.9 * (1 - eased));

                // damage enemies that are within current radius (only once per enemy)
                const radius = scale;
                for (const en of this.enemies) {
                    try {
                        if (!en || !en.alive) continue;
                        const pos = en.mesh ? en.mesh.position : (en.position || new THREE.Vector3());
                        const d = pos.distanceTo(origin);
                        if (d <= radius) {
                            // destroy enemy
                            try { en.destroy(); } catch(e){ if (en.mesh) try { this.scene.remove(en.mesh); } catch(e){} }
                        }
                    } catch (e) {}
                }

                if (t < 1) requestAnimationFrame(tick);
                else {
                    try { this.scene.remove(sphere); } catch(e){}
                }
            };
            tick();
        } catch (e) {
            console.warn('throwBomb failed', e);
        }
    }
}

const game = new Game();

// Initialize multiplayer & chat if WebsimSocket is available
game.initMultiplayer = async function () {
    if (typeof WebsimSocket === 'undefined') {
        console.warn('WebsimSocket not available; multiplayer disabled.');
        return;
    }

    try {
        this.room = new WebsimSocket();
        await this.room.initialize();

        // update peer count display
        const peerCountEl = document.getElementById('peer-count');
        const chatMessagesEl = document.getElementById('chat-messages');
        const chatInput = document.getElementById('chat-input');
        const chatSend = document.getElementById('chat-send');

        // container for 3D sprites representing other players
        this.peerSprites = {}; // keyed by clientId
        const textureLoader = new THREE.TextureLoader();

        const renderPeerCount = () => {
            const count = Object.keys(this.room.peers || {}).length;
            if (peerCountEl) peerCountEl.textContent = String(count);
        };
        renderPeerCount();

        // Helper: create a sprite for a peer
        const createPeerSprite = (clientId, peerInfo) => {
            // try avatarUrl, fallback to builder G icon
            const avatar = (peerInfo && peerInfo.avatarUrl) ? peerInfo.avatarUrl : '/channels4_profile (5).jpg';
            const tex = textureLoader.load(avatar, undefined, undefined, () => {});
            const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
            const sprite = new THREE.Sprite(mat);
            sprite.scale.set(1.8, 1.8, 1);
            // place near origin until presence provides a position
            sprite.position.set(0, 1.2, 0);
            sprite.userData.clientId = clientId;
            this.scene.add(sprite);
            this.peerSprites[clientId] = sprite;
            return sprite;
        };

        // Remove a peer sprite
        const removePeerSprite = (clientId) => {
            const s = this.peerSprites[clientId];
            if (s) {
                try { this.scene.remove(s); } catch (e) {}
                try { if (s.material && s.material.map && s.material.map.dispose) s.material.map.dispose(); } catch(e){}
                try { if (s.material && s.material.dispose) s.material.dispose(); } catch(e){}
                delete this.peerSprites[clientId];
            }
        };

        // Create sprites for any peers that exist now
        Object.entries(this.room.peers || {}).forEach(([id, info]) => {
            if (id === this.room.clientId) return; // skip self
            createPeerSprite(id, info);
        });
        renderPeerCount();

        // Subscribe to presence updates: create/remove sprites as peers join/leave
        this.room.subscribePresence((currentPresence) => {
            // ensure sprites exist for connected peers
            Object.entries(this.room.peers || {}).forEach(([id, info]) => {
                if (id === this.room.clientId) return;
                if (!this.peerSprites[id]) createPeerSprite(id, info);
            });
            // remove sprites for peers that left
            Object.keys(this.peerSprites).forEach(id => {
                if (!this.room.peers || !this.room.peers[id]) {
                    removePeerSprite(id);
                }
            });
            renderPeerCount();
        });

        // Also refresh when room state changes (keeps count accurate)
        this.room.subscribeRoomState(() => renderPeerCount());

        // basic swear filter (case-insensitive)
        const banned = ['swear1','swear2','damn','shit','f***']; // add more as needed
        const containsBanned = (text) => {
            if (!text) return false;
            const t = text.toLowerCase();
            return banned.some(b => b && t.includes(b));
        };

        // display helper
        const addChat = (who, text) => {
            if (!chatMessagesEl) return;
            const el = document.createElement('div');
            el.style.marginBottom = '6px';
            el.innerHTML = `<strong>${who}:</strong> ${text}`;
            chatMessagesEl.appendChild(el);
            chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
        };

        // handle incoming chat events
        this.room.onmessage = (event) => {
            const data = event.data;
            if (!data) return;
            if (data.type === 'chat') {
                // profanity check on incoming messages
                if (containsBanned(data.text)) {
                    // show message then redirect the sender (this client can't ban others remotely)
                    addChat('SYSTEM', `${data.username} used banned words — redirecting...`);
                    // If this client is the one who sent the bad message, redirect them
                    if (data.clientId === this.room.clientId) {
                        window.location.href = 'https://websim.com/';
                    }
                } else {
                    addChat(data.username || 'Player', data.text);
                }
            }
        };

        // send chat
        const sendChat = (text) => {
            if (!this.room) return;
            if (!text) return;
            if (containsBanned(text)) {
                // immediate client-side enforcement: warn then redirect
                addChat('You', text);
                alert('You used prohibited language and will be redirected.');
                window.location.href = 'https://websim.com/';
                return;
            }
            // broadcast chat event (echo true so sender sees it through onmessage)
            this.room.send({ type: 'chat', text: text, echo: true });
            // locally show quickly (some rooms echo automatically)
            addChat(this.room.peers[this.room.clientId]?.username || 'You', text);
            if (chatInput) chatInput.value = '';
        };

        if (chatSend && chatInput) {
            chatSend.addEventListener('click', () => sendChat(chatInput.value.trim()));
            chatInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') sendChat(chatInput.value.trim());
            });
        }

    } catch (err) {
        console.error('Multiplayer init failed', err);
    }
};

game.initMultiplayer();