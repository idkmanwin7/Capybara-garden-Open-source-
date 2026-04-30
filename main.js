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

        // Easter egg: key that can spawn near a tree/bush and unlock a door
        this.easterKey = null; // sprite reference
        this.easterKeyPicked = false;
        this._keySpawnedNear = null; // reference to vegetation item used
        this.spawnKeyNearTreeIfVisible = () => {
            try {
                if (this.easterKey || this.easterKeyPicked) return;
                // find a vegetation item that looks like a "tree" or bush (use tracked vegetation items)
                if (!this.world || !Array.isArray(this.world._vegetationItems) || this.world._vegetationItems.length === 0) return;
                // pick a random vegetation item as "tree"
                const candidates = this.world._vegetationItems.filter(it => it && it.position);
                if (!candidates.length) return;
                const pick = candidates[Math.floor(Math.random() * candidates.length)];
                // spawn key near that vegetation
                const loader = new THREE.TextureLoader();
                const keyTex = loader.load('/warning-sign-icon-transparent-background-free-png.webp'); // reuse small asset as placeholder if no key image
                const mat = new THREE.SpriteMaterial({ map: keyTex, color: 0xFFFF66, transparent: true });
                const keySprite = new THREE.Sprite(mat);
                keySprite.scale.set(0.6, 0.6, 1);
                keySprite.position.copy(pick.position).add(new THREE.Vector3(0, 0.8, 0));
                keySprite.name = 'EasterKey';
                keySprite.userData.isKey = true;
                this.scene.add(keySprite);
                this.easterKey = keySprite;
                this._keySpawnedNear = pick;
                if (this._announcementText) {
                    this._announcementText.textContent = "You spot something shiny near a tree...";
                    setTimeout(()=>{ try{ this._announcementText.textContent = 'UPDATES MORE SOON!'; }catch(e){} }, 2500);
                }
            } catch (e) { console.warn('spawnKey failed', e); }
        };

        // helper to return/play TTS using websim.textToSpeech if available, fallback to speechSynthesis
        this.playBuilderGVoice = async (text) => {
            try {
                if (window.websim && typeof window.websim.textToSpeech === 'function') {
                    const res = await websim.textToSpeech({ text: text, voice: 'en-male' });
                    if (res && res.url) {
                        const a = new Audio(res.url);
                        a.play().catch(()=>{});
                        return;
                    }
                }
            } catch (e) { console.warn('websim TTS failed', e); }
            // fallback: use browser speechSynthesis
            try {
                const utter = new SpeechSynthesisUtterance(text);
                window.speechSynthesis.cancel();
                window.speechSynthesis.speak(utter);
            } catch (e) {}
        };

        // Add a simple door object near the house that can be "unlocked" by the key
        try {
            this._easterDoor = null;
            if (this.world && this.world.houseGroup) {
                const doorGeom = new THREE.BoxGeometry(0.6, 1.2, 0.08);
                const doorMat = new THREE.MeshStandardMaterial({ color: 0x332211 });
                const door = new THREE.Mesh(doorGeom, doorMat);
                door.position.set(this.world.houseGroup.position.x, 0.6, this.world.houseGroup.position.z + 1.5);
                door.name = 'EasterDoor';
                this.scene.add(door);
                this._easterDoor = door;
                this._easterDoor.userData.locked = true;
            }
        } catch (e) { console.warn('failed to create easter door', e); }

        // --- Christmas event detection (Dec or Jan, ends Feb 1) ---
        const now = new Date();
        const month = now.getMonth(); // 0 = Jan, 11 = Dec
        const day = now.getDate();
        const year = now.getFullYear();
        // Start if December (11) or January (0), run until Feb 1 of the corresponding year
        const christmasStart = (month === 11 || month === 0);
        const christmasEndDate = new Date(year + (month === 11 ? 1 : 0), 1, 1); // Feb 1 next year if Dec else Feb 1 this year
        const beforeFeb1 = now < christmasEndDate;
        this.christmasMode = christmasStart && beforeFeb1;

        // allow manual override via console: game.forceChristmas(true/false)
        window.forceChristmas = (v) => {
            this.christmasMode = Boolean(v);
            if (this.world && typeof this.world.applyChristmas === 'function') {
                this.world.applyChristmas(this.christmasMode);
                this.scene.userData.christmas = this.christmasMode;
            }
        };
        // apply to world immediately
        if (this.world && typeof this.world.applyChristmas === 'function') {
            this.world.applyChristmas(this.christmasMode);
            this.scene.userData.christmas = this.christmasMode;
        }
        
        this.camera.position.set(0, 10, 10);
        this.camera.lookAt(0, 0, 0);

        // No-cheat protection: enforce quick-actions rules (set true to block quick-spawn cheats)
        this.noCheat = true;
        try { window.noCheat = this.noCheat; } catch(e){}

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
            points: 0,
            // currency + skins
            diamonds: 700, // starting diamonds
            ownedSkins: { default: true }, // default skin free
            equippedSkin: 'default'
        };
        this.enemies = [];
        this.enemySpawnTimer = 0;

        // Achievements & persistence: track fast-infectors kills and unlock Nightmare mode
        try {
            // load achievements from localStorage (simple JSON)
            const saved = localStorage.getItem('capybara_achievements');
            this.achievements = saved ? Object.assign({
                survivedFastInfectors: false,
                nightmareUnlocked: false,
                fastInfectorsBestKills: 0
            }, JSON.parse(saved)) : {
                survivedFastInfectors: false,
                nightmareUnlocked: false,
                fastInfectorsBestKills: 0
            };

            // helper to persist achievements
            this.saveAchievements = () => {
                try {
                    localStorage.setItem('capybara_achievements', JSON.stringify(this.achievements));
                } catch (e) { console.warn('Failed to save achievements', e); }
            };

            // If Nightmare already unlocked, enable the main menu button (unlocks the UI)
            try {
                if (this.achievements.nightmareUnlocked) {
                    // find the disabled Nightmare button by text
                    Array.from(document.querySelectorAll('button')).forEach(b => {
                        if (b.textContent && b.textContent.toLowerCase().includes('nightmare')) {
                            b.disabled = false;
                            b.title = 'Nightmare (Unlocked)';
                            b.style.background = '#b71c1c';
                            b.style.cursor = 'pointer';
                        }
                    });
                }
            } catch(e){}
        } catch (e) {
            this.achievements = { survivedFastInfectors: false, nightmareUnlocked: false, fastInfectorsBestKills: 0 };
            this.saveAchievements = () => {};
        }

        // Hook up announcement / daily challenge UI
        this._challengeTimerEl = document.getElementById('challenge-timer');
        this._claimBtn = document.getElementById('claim-diamond');
        this._pointsEl = document.getElementById('points-counter');
        this._announcementText = document.getElementById('announcement-text');

        // Jam Event (KONG KONG) scheduling and helpers
        // This is a themed Chinese Jam Event: KONG KONG festival lights, storm & lightning visuals,
        // and Cashy becomes a guardian "god" who strikes nearby enemies during the event.
        // Event may start on April 30 or May 9 and ends on May 11 (inclusive)
        this.jamEvent = {
            active: false,
            startDates: ['2026-04-30', '2026-05-09'],
            endDate: '2026-05-11',
            lightTicker: null,
            cashyTicker: null,
            stormTicker: null,
            isChineseEvent: true
        };

        (function initJamEvent(game) {
            try {
                const now = new Date();
                now.setHours(0,0,0,0);
                const end = new Date(game.jamEvent.endDate);
                end.setHours(23,59,59,999);
                const active = game.jamEvent.startDates.some(sd => {
                    const start = new Date(sd);
                    start.setHours(0,0,0,0);
                    return now >= start && now <= end;
                });
                if (active) {
                    game.jamEvent.active = true;
                    // event label emphasises Chinese festival details
                    try { if (game._announcementText) game._announcementText.textContent = 'Jam Event (KONG KONG) — Chinese Festival: Storm & Lightning, Cashy the Guardian is active!'; } catch(e){}
                    // start light pulsing effect for event (festival lanterns / lights)
                    try {
                        let phase = 0;
                        game.jamEvent.lightTicker = setInterval(() => {
                            try {
                                if (!game.jamEvent.active) return;
                                phase += 0.22;
                                const pulse = 0.9 + Math.abs(Math.sin(phase)) * 0.5;
                                // apply pulse to any directional lights in scene
                                game.scene && game.scene.children && game.scene.children.forEach(c => {
                                    try {
                                        if (c.type === 'DirectionalLight' || c.type === 'PointLight') {
                                            c.intensity = Math.min(3.2, Math.max(0.2, pulse));
                                            // subtle color shift toward warm festival lantern hue
                                            if (c.color) {
                                                const warm = new THREE.Color(0xffd27f);
                                                c.color.lerp(warm, 0.06);
                                            }
                                        }
                                    } catch(e){}
                                });
                            } catch(e){}
                        }, 360);
                    } catch (e) {}

                    // start storm & lightning effect: occasional bright flashes and short thunder chime
                    try {
                        game.jamEvent.stormTicker = setInterval(() => {
                            try {
                                if (!game.jamEvent.active) return;
                                // lightning flash: boost directional lights briefly
                                const flashes = Math.random() > 0.6 ? 1 + Math.floor(Math.random()*2) : 0;
                                for (let i=0;i<flashes;i++) {
                                    setTimeout(() => {
                                        try {
                                            // flash all lights
                                            const origs = [];
                                            game.scene && game.scene.children && game.scene.children.forEach(c => {
                                                try {
                                                    if (c.type === 'DirectionalLight' || c.type === 'PointLight') {
                                                        origs.push({ c, intensity: c.intensity, color: c.color ? c.color.clone() : null });
                                                        c.intensity = (c.intensity || 1) * (1.6 + Math.random()*1.2);
                                                        if (c.color) c.color.lerp(new THREE.Color(0xfff8e2), 0.25);
                                                    }
                                                } catch(e){}
                                            });
                                            // play lightning chime
                                            try { if (game.alertsEnabled) game.playSound('day'); } catch(e){}
                                            // restore after short delay
                                            setTimeout(() => {
                                                try {
                                                    origs.forEach(o => {
                                                        try { if (o.c) { o.c.intensity = o.intensity; if (o.color && o.c.color) o.c.color.copy(o.color); } } catch(e){}
                                                    });
                                                } catch(e){}
                                            }, 260 + Math.random()*300);
                                        } catch(e){}
                                    }, i * 120);
                                }
                            } catch(e){}
                        }, 2200 + Math.random()*1600);
                    } catch (e) {}

                    // Cashy becomes a festival guardian: periodically strike nearby enemies with lightning bolts
                    try {
                        // avoid double-ticker
                        if (game.jamEvent.cashyTicker) clearInterval(game.jamEvent.cashyTicker);
                        // initialize a per-game Cashy kill counter if missing
                        game._cashyKillCount = game._cashyKillCount || 0;
                        game.jamEvent.cashyTicker = setInterval(() => {
                            try {
                                if (!game.jamEvent.active) return;
                                if (!game.world || !game.world.cashy) return;
                                const cashy = game.world.cashy;
                                // find enemies within a radius
                                const radius = 8.5;
                                const enemiesNearby = (game.enemies || []).filter(en => {
                                    try {
                                        if (!en || !en.alive || !en.mesh || !en.mesh.position) return false;
                                        return en.mesh.position.distanceTo(cashy.position) <= radius;
                                    } catch (e) { return false; }
                                });
                                if (!enemiesNearby.length) return;
                                // Cashy divine strike: damage, play scream/electric sounds, and (during Jam Event) spawn a purple moon trap that immobilizes nearby enemies
                                const strikes = Math.min(3, enemiesNearby.length);
                                for (let i=0;i<strikes;i++) {
                                    const en = enemiesNearby[i];
                                    try {
                                        // lightning visual: bright sphere at enemy position
                                        const bolt = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 8), new THREE.MeshStandardMaterial({ color: 0x9be6ff, emissive: 0xffffff, emissiveIntensity: 2 }));
                                        bolt.position.copy(en.mesh.position).add(new THREE.Vector3(0,0.6,0));
                                        game.scene.add(bolt);
                                        setTimeout(()=>{ try{ game.scene.remove(bolt); }catch(e){} }, 360);

                                        // Play male scream + electric impact (best-effort via HTMLAudio so it works without changing loadSounds)
                                        try {
                                            const scream = new Audio('/I-found-Ishoweyes.mp3'); // tense ambient clip as a male/ominous scream fallback
                                            scream.volume = 0.9;
                                            scream.play().catch(()=>{});
                                        } catch(e){}

                                        try {
                                            const electric = new Audio('/chicken-feet-jumpscare-sound-made-with-Voicemod.mp3');
                                            electric.volume = 0.9;
                                            electric.play().catch(()=>{});
                                        } catch(e){}

                                        // If Jam Event is active, create a purple moon trap that immobilizes nearby enemies briefly
                                        if (game.jamEvent && game.jamEvent.active) {
                                            try {
                                                const moon = new THREE.Mesh(
                                                    new THREE.SphereGeometry(1.2, 16, 12),
                                                    new THREE.MeshStandardMaterial({ color: 0x7b3bff, transparent: true, opacity: 0.56, emissive: 0x4d00ff, emissiveIntensity: 0.9 })
                                                );
                                                moon.position.copy(en.mesh.position).add(new THREE.Vector3(0,0.9,0));
                                                moon.name = 'purple_moon_trap';
                                                game.scene.add(moon);
                                                // trap radius effect: immobilize enemies within radius for a short duration
                                                const trapRadius = 3.2;
                                                const trapped = [];
                                                (game.enemies || []).forEach(other => {
                                                    try {
                                                        if (!other || !other.alive || !other.mesh) return;
                                                        const d = other.mesh.position.distanceTo(moon.position);
                                                        if (d <= trapRadius) {
                                                            // mark and reduce speed (best-effort)
                                                            other.userData = other.userData || {};
                                                            other.userData._trappedByCashy = true;
                                                            other.userData._origSpeed = other.speed || other.userData._origSpeed ||  (other.speed || 0);
                                                            try { other.speed = 0; } catch(e){}
                                                            // tint enemy visually to indicate trapped
                                                            try { if (other.mesh.material && other.mesh.material.color) other.mesh.material.color.lerp(new THREE.Color(0x7b3bff), 0.6); } catch(e){}
                                                            trapped.push(other);
                                                        }
                                                    } catch(e){}
                                                });
                                                // If any struck enemy was killed by this strike, increment Cashy's kill count
                                                // Best-effort: if enemy exposes takeDamage, call a lethal damage then detect alive->dead
                                                try {
                                                    if (typeof en.takeDamage === 'function') {
                                                        // attempt lethal damage to ensure kill
                                                        en.takeDamage(99999);
                                                    } else {
                                                        // fallback: remove mesh to simulate death
                                                        if (en.destroy) en.destroy();
                                                        else if (en.mesh) try { game.scene.remove(en.mesh); } catch(e){}
                                                    }
                                                } catch(e){}
                                                // Count kills: scan trapped list for those now not alive or removed
                                                let newlyKilled = 0;
                                                trapped.forEach(o => {
                                                    try {
                                                        const stillAlive = !!(o && o.alive);
                                                        if (!stillAlive) newlyKilled++;
                                                    } catch(e){}
                                                });
                                                // also count the primary en we struck if it's now dead/removed
                                                try {
                                                    if (!(en && en.alive)) newlyKilled++;
                                                } catch(e){}
                                                if (newlyKilled > 0) {
                                                    game._cashyKillCount = (game._cashyKillCount || 0) + newlyKilled;
                                                    // Announcement of Cashy kill tally
                                                    try { if (game._announcementText) game._announcementText.textContent = `Cashy: Boom Combo progress ${game._cashyKillCount}/7`; } catch(e){}
                                                }
                                                // release trap after 4 seconds
                                                setTimeout(()=> {
                                                    try {
                                                        trapped.forEach(o => {
                                                            try {
                                                                if (o) {
                                                                    o.userData = o.userData || {};
                                                                    if (o.userData._trappedByCashy) {
                                                                        o.userData._trappedByCashy = false;
                                                                        if (o.userData._origSpeed !== undefined) {
                                                                            try { o.speed = o.userData._origSpeed; } catch(e){}
                                                                        }
                                                                        // restore tint by slowly lerping back (best-effort)
                                                                        try { if (o.mesh && o.mesh.material && o.mesh.material.color) o.mesh.material.color.lerp(new THREE.Color(0xffffff), 0.6); } catch(e){}
                                                                    }
                                                                }
                                                            } catch(e){}
                                                        });
                                                        try { game.scene.remove(moon); } catch(e){}
                                                    } catch(e){}
                                                }, 4000);
                                            } catch(e){}
                                            // Short announcement for trap activation
                                            try { if (game._announcementText) game._announcementText.textContent = 'Cashy: Purple Moon deployed! Enemies trapped.'; } catch(e){}
                                        } else {
                                            // apply damage: prefer takeDamage if function exists, otherwise destroy (non-jam behavior)
                                            if (typeof en.takeDamage === 'function') {
                                                try { en.takeDamage(9000); } catch(e){ if (en.destroy) en.destroy(); else if (en.mesh) { try{ game.scene.remove(en.mesh); }catch(e){} } }
                                            } else {
                                                try { if (en.destroy) en.destroy(); else if (en.mesh) game.scene.remove(en.mesh); } catch(e){}
                                            }
                                            // Also count the kill here
                                            try {
                                                if (!(en && en.alive)) {
                                                    game._cashyKillCount = (game._cashyKillCount || 0) + 1;
                                                    try { if (game._announcementText) game._announcementText.textContent = `Cashy: Boom Combo progress ${game._cashyKillCount}/7`; } catch(e){}
                                                }
                                            } catch(e){}
                                            try { if (game._announcementText) game._announcementText.textContent = 'Cashy: Guardian strike!'; } catch(e){}
                                        }
                                    } catch (e) {}
                                }
                                // If Cashy reached 7 kills during Jam Event, trigger Boom Combo (storm tornado instakill)
                                try {
                                    if ((game._cashyKillCount || 0) >= 7) {
                                        // reset counter
                                        game._cashyKillCount = 0;
                                        // create a tornado visual and instakill nearby enemies
                                        try {
                                            const center = cashy.position.clone();
                                            // tornado: ring of small spheres that expand and vanish
                                            const parts = [];
                                            for (let p = 0; p < 18; p++) {
                                                const angle = (p / 18) * Math.PI * 2;
                                                const sph = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), new THREE.MeshStandardMaterial({ color: 0xaaaaee, emissive: 0x7744ff }));
                                                sph.position.copy(center).add(new THREE.Vector3(Math.cos(angle) * 0.8, 0.6 + Math.random()*0.6, Math.sin(angle) * 0.8));
                                                game.scene.add(sph);
                                                parts.push(sph);
                                            }
                                            // expand and remove parts over 1s
                                            const t0 = performance.now();
                                            const dur = 1000;
                                            const expandTick = (now) => {
                                                const elapsed = now - t0;
                                                const t = Math.min(1, elapsed / dur);
                                                const scale = 1 + t * 6.0;
                                                parts.forEach((s, i) => {
                                                    try {
                                                        s.scale.setScalar(scale);
                                                        s.position.y += 0.01 + t * 0.2;
                                                        s.material.opacity = Math.max(0, 1 - t);
                                                    } catch (e) {}
                                                });
                                                if (t < 1) requestAnimationFrame(expandTick);
                                                else {
                                                    parts.forEach(s => { try { game.scene.remove(s); } catch(e){} });
                                                }
                                            };
                                            requestAnimationFrame(expandTick);
                                            // play a thunderous sound if available
                                            try { if (game.alertsEnabled) game.playSound('day'); } catch(e){}
                                            // Instakill all enemies within a larger radius (tornado effect)
                                            const instaRadius = 14;
                                            const killedNow = [];
                                            (game.enemies || []).forEach(other => {
                                                try {
                                                    if (!other || !other.alive || !other.mesh) return;
                                                    const d = other.mesh.position.distanceTo(center);
                                                    if (d <= instaRadius) {
                                                        try { if (typeof other.takeDamage === 'function') other.takeDamage(999999); else if (other.destroy) other.destroy(); else if (other.mesh) game.scene.remove(other.mesh); } catch(e){}
                                                        killedNow.push(other);
                                                    }
                                                } catch(e){}
                                            });
                                            // Announcement
                                            try { if (game._announcementText) game._announcementText.textContent = `BOOM COMBO! Cashy unleashed a storm tornado and cleared ${killedNow.length} enemies!`; } catch(e){}
                                        } catch (e) { console.warn('Boom Combo visual failed', e); }
                                    }
                                } catch (e) {}
                            } catch (e) {}
                        }, 800 + Math.random()*600);
                    } catch (e) {}

                }
                // expose helper to programmatically end event (if needed)
                game.endJamEvent = function() {
                    try {
                        game.jamEvent.active = false;
                        if (game.jamEvent.lightTicker) { clearInterval(game.jamEvent.lightTicker); game.jamEvent.lightTicker = null; }
                        if (game.jamEvent.stormTicker) { clearInterval(game.jamEvent.stormTicker); game.jamEvent.stormTicker = null; }
                        if (game.jamEvent.cashyTicker) { clearInterval(game.jamEvent.cashyTicker); game.jamEvent.cashyTicker = null; }
                        try { if (game._announcementText) game._announcementText.textContent = 'Jam Event ended.'; } catch(e){}
                    } catch (e) {}
                };
                // helper to transform Builder G into Kung-Fu mode (visual only)
                game.transformBuilderToKungFu = function() {
                    try {
                        if (!game.world || !game.world.builderG) return;
                        const b = game.world.builderG;
                        if (b.userData && b.userData.kungFu) return; // already kung-fu
                        b.userData = b.userData || {};
                        b.userData.kungFu = true;
                        // visual tweak: tint, scale, and quick spin
                        try {
                            if (b.material && b.material.color) b.material.color.setHex(0xffdd55);
                            b.scale.set((b.scale.x || 2) * 1.4, (b.scale.y || 2) * 1.4, 1);
                            // quick bounce/spin effect
                            const origY = b.position.y;
                            let t0 = performance.now();
                            const dur = 600;
                            const anim = (now) => {
                                const p = Math.min(1, (now - t0) / dur);
                                try { b.rotation && (b.rotation.z = p * Math.PI * 2 * 0.4); } catch(e){}
                                try { b.position.y = origY + Math.sin(p * Math.PI) * 0.6; } catch(e){}
                                if (p < 1) requestAnimationFrame(anim);
                            };
                            requestAnimationFrame(anim);
                        } catch (e) {}
                        try { if (game._announcementText) game._announcementText.textContent = 'Builder G: KUNG-FU MODE! KONG KONG!'; } catch(e){}
                    } catch (e) {}
                };
            } catch (e) {
                console.warn('Jam event init failed', e);
            }
        })(this);

        // Theme selector wiring (Default, Halloween, Christmas, Spring locked)
        try {
            const themeSelect = document.getElementById('theme-select');
            const themeNote = document.getElementById('theme-note');
            const applyTheme = (t) => {
                // Default: reset visuals and clear special theme UIs
                if (t === 'default') {
                    try {
                        this.scene.background = new THREE.Color(0x87CEEB);
                        this.scene.fog = new THREE.Fog(0x87CEEB, 20, 50);
                        if (this.world && typeof this.world.applyChristmas === 'function') this.world.applyChristmas(false);
                        // clear CapyBrothers shop if present
                        const shop = document.getElementById('capybrothers-shop');
                        if (shop) shop.remove();
                        if (this.world && typeof this.world.clearCapyBrothers === 'function') this.world.clearCapyBrothers();
                        // clear fruity UI if present
                        const fruityPanel = document.getElementById('fruity-panel');
                        if (fruityPanel) fruityPanel.remove();
                    } catch (e) {}
                    if (themeNote) themeNote.textContent = 'Default theme applied.';
                    if (this._announcementText) { this._announcementText.textContent = 'Theme: Default'; setTimeout(()=>{ this._announcementText.textContent='UPDATES MORE SOON!'; },1400); }
                    return;
                }

                // Halloween: orange/purple sky and subtle fog, no pet changes
                if (t === 'halloween') {
                    try {
                        this.scene.background = new THREE.Color(0x2e0b1f); // dark purple
                        this.scene.fog = new THREE.FogExp2(0x2e0b1f, 0.03);
                        // tint vegetation slightly
                        if (this.world && this.world._vegetationItems) {
                            this.world._vegetationItems.forEach(it => {
                                try { if (it.material && it.material.color) it.material.color.lerp(new THREE.Color(0x803020), 0.25); } catch(e){}
                            });
                        }
                        // spawn jack-o'-lantern collectibles near the player/world points
                        try {
                            if (this.world && typeof this.world.spawnJackOLanterns === 'function') {
                                this.world.spawnJackOLanterns(8);
                            }
                        } catch (e) { console.warn('Failed to spawn jack-o-lanterns', e); }
                    } catch (e) {}
                    if (themeNote) themeNote.textContent = 'Halloween theme applied: spooky sky, fog & pumpkins.';
                    if (this._announcementText) { this._announcementText.textContent = 'Theme: Halloween — collect jack-o\'-lanterns to protect your pets!'; setTimeout(()=>{ this._announcementText.textContent='UPDATES MORE SOON!'; },1600); }
                    return;
                }

                // Christmas: use world helper for snow visuals (if available)
                if (t === 'christmas') {
                    try {
                        if (this.world && typeof this.world.applyChristmas === 'function') {
                            this.world.applyChristmas(true);
                            this.scene.userData.christmas = true;
                        } else {
                            this.scene.background = new THREE.Color(0xE6F3FF);
                            this.scene.fog = new THREE.FogExp2(0xE6F3FF, 0.02);
                        }
                    } catch (e) {}
                    if (themeNote) themeNote.textContent = 'Christmas theme applied: winter visuals enabled.';
                    if (this._announcementText) { this._announcementText.textContent = 'Theme: Christmas'; setTimeout(()=>{ this._announcementText.textContent='UPDATES MORE SOON!'; },1400); }
                    return;
                }

                // Fruity Theme: warm orange sky, spawn orange trees and fruits
                if (t === 'fruity') {
                    try {
                        // warm/orange sky and lighter fog
                        this.scene.background = new THREE.Color(0xFFD9B3);
                        this.scene.fog = new THREE.FogExp2(0xFFD9B3, 0.02);

                        // create a small Fruity panel UI for fruit count and a "Harvest" button
                        let panel = document.getElementById('fruity-panel');
                        if (!panel) {
                            panel = document.createElement('div');
                            panel.id = 'fruity-panel';
                            panel.style.position = 'fixed';
                            panel.style.left = '18px';
                            panel.style.bottom = '120px';
                            panel.style.zIndex = '10005';
                            panel.style.background = 'rgba(255,255,255,0.95)';
                            panel.style.color = '#111';
                            panel.style.padding = '10px';
                            panel.style.borderRadius = '10px';
                            panel.style.boxShadow = '0 8px 24px rgba(0,0,0,0.15)';
                            panel.style.fontFamily = 'Segoe UI, Tahoma, sans-serif';
                            panel.innerHTML = `
                                <div style="font-weight:800;margin-bottom:6px;">Fruity Theme</div>
                                <div style="font-size:13px;margin-bottom:8px;">Oranges harvested: <span id="fruity-count">0</span></div>
                                <div style="display:flex;gap:8px;">
                                    <button id="fruity-harvest" style="flex:1;padding:8px;border-radius:8px;border:0;background:#FF8C00;color:white;cursor:pointer;">Harvest Nearby</button>
                                    <button id="fruity-plant" style="flex:1;padding:8px;border-radius:8px;border:0;background:#8BC34A;color:white;cursor:pointer;">Plant Orange Tree</button>
                                </div>
                            `;
                            document.body.appendChild(panel);

                            panel.querySelector('#fruity-harvest').addEventListener('click', () => {
                                try {
                                    // collect nearby fruits (orange spheres added below) within 2.2 units
                                    const fruits = (this._fruityFruits || []).filter(f => f && f.position && f.userData && !f.userData.collected);
                                    let collected = 0;
                                    for (const f of fruits) {
                                        if (f.position.distanceTo(this.player.mesh.position) < 2.2) {
                                            f.userData.collected = true;
                                            try { this.scene.remove(f); } catch(e){}
                                            collected++;
                                        }
                                    }
                                    if (!this.gameState.fruityCount) this.gameState.fruityCount = 0;
                                    this.gameState.fruityCount += collected;
                                    const el = document.getElementById('fruity-count');
                                    if (el) el.textContent = String(this.gameState.fruityCount);
                                    if (this._announcementText) {
                                        this._announcementText.textContent = `Harvested ${collected} oranges.`;
                                        setTimeout(()=>{ try{ this._announcementText.textContent='UPDATES MORE SOON!'; }catch(e){} }, 1400);
                                    }
                                } catch (e) { console.warn('Fruity harvest failed', e); }
                            });

                            panel.querySelector('#fruity-plant').addEventListener('click', () => {
                                try {
                                    // plant an orange tree near the player
                                    const pos = this.player.mesh.position.clone().add(new THREE.Vector3((Math.random()-0.5)*4, 0, (Math.random()-0.5)*4));
                                    // create simple trunk + canopy + fruits
                                    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12,0.18,1.2), new THREE.MeshStandardMaterial({ color: 0x8B5A2B }));
                                    trunk.position.copy(pos).add(new THREE.Vector3(0,0.6,0));
                                    this.scene.add(trunk);
                                    const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.9,12,12), new THREE.MeshStandardMaterial({ color: 0x2e8b2e }));
                                    canopy.position.copy(pos).add(new THREE.Vector3(0,1.6,0));
                                    this.scene.add(canopy);
                                    // spawn a few orange fruits as spheres under canopy
                                    this._fruityFruits = this._fruityFruits || [];
                                    for (let i=0;i<5;i++) {
                                        const fruit = new THREE.Mesh(new THREE.SphereGeometry(0.12,8,8), new THREE.MeshStandardMaterial({ color: 0xFF8C00, emissive: 0xff6a00 }));
                                        const angle = Math.random()*Math.PI*2;
                                        const r = 0.5 + Math.random()*0.4;
                                        const fx = canopy.position.x + Math.cos(angle)*r;
                                        const fz = canopy.position.z + Math.sin(angle)*r;
                                        fruit.position.set(fx, canopy.position.y - 0.18 + (Math.random()-0.5)*0.12, fz);
                                        fruit.userData = { collected:false };
                                        this.scene.add(fruit);
                                        this._fruityFruits.push(fruit);
                                    }
                                    if (this._announcementText) {
                                        this._announcementText.textContent = 'Orange tree planted!';
                                        setTimeout(()=>{ try{ this._announcementText.textContent='UPDATES MORE SOON!'; }catch(e){} }, 1400);
                                    }
                                } catch (e) { console.warn('Failed to plant orange tree', e); }
                            });
                        }

                        // spawn a few orange trees around the world when theme applied (non-destructive)
                        try {
                            // keep references to remove later if theme changed
                            this._fruityTrees = this._fruityTrees || [];
                            // create 6 trees near player and scattered positions
                            for (let i = 0; i < 6; i++) {
                                const ang = Math.random() * Math.PI * 2;
                                const r = 6 + Math.random() * 18;
                                const pos = (this.player && this.player.mesh) ? this.player.mesh.position.clone().add(new THREE.Vector3(Math.cos(ang) * r, 0, Math.sin(ang) * r)) : new THREE.Vector3(Math.cos(ang) * r, 0, Math.sin(ang) * r);
                                const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12,0.18,1.2), new THREE.MeshStandardMaterial({ color: 0x8B5A2B }));
                                trunk.position.copy(pos).add(new THREE.Vector3(0,0.6,0));
                                this.scene.add(trunk);
                                const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.9,12,12), new THREE.MeshStandardMaterial({ color: 0x2e8b2e }));
                                canopy.position.copy(pos).add(new THREE.Vector3(0,1.6,0));
                                this.scene.add(canopy);

                                // fruits
                                this._fruityFruits = this._fruityFruits || [];
                                for (let f=0; f<4; f++) {
                                    const fruit = new THREE.Mesh(new THREE.SphereGeometry(0.12,8,8), new THREE.MeshStandardMaterial({ color: 0xFF8C00, emissive: 0xff6a00 }));
                                    const a = Math.random()*Math.PI*2;
                                    const rr = 0.4 + Math.random()*0.5;
                                    fruit.position.set(canopy.position.x + Math.cos(a)*rr, canopy.position.y - 0.18 + (Math.random()-0.5)*0.12, canopy.position.z + Math.sin(a)*rr);
                                    fruit.userData = { collected:false };
                                    this.scene.add(fruit);
                                    this._fruityFruits.push(fruit);
                                }

                                this._fruityTrees.push({ trunk, canopy });
                            }
                        } catch (e) { console.warn('Failed to spawn fruity trees', e); }

                    } catch (e) {}
                    if (themeNote) themeNote.textContent = 'Fruity theme applied: orange trees and harvest UI added.';
                    if (this._announcementText) { this._announcementText.textContent = 'Theme: Fruity — explore orange groves & harvest!'; setTimeout(()=>{ this._announcementText.textContent='UPDATES MORE SOON!'; },1600); }
                    return;
                }

                // CapyBrothers: many capybaras building a town, coins economy & shop for fruits
                if (t === 'capybrothers') {
                    try {
                        // visual tint for town-building
                        this.scene.background = new THREE.Color(0xdfe9d6);
                        this.scene.fog = new THREE.FogExp2(0xdfe9d6, 0.02);

                        // initialize coin economy in gameState
                        this.gameState.coins = this.gameState.coins || 0;

                        // spawn a team of capybara workers in the world
                        if (this.world && typeof this.world.spawnCapyBrothers === 'function') {
                            // spawn ~12 working capybaras
                            this.world.spawnCapyBrothers(12);
                        }

                        // create a small shop UI for CapyBrothers theme (buy fruits like watermelon)
                        let shop = document.getElementById('capybrothers-shop');
                        if (!shop) {
                            shop = document.createElement('div');
                            shop.id = 'capybrothers-shop';
                            shop.style.position = 'fixed';
                            shop.style.right = '18px';
                            shop.style.top = '220px';
                            shop.style.zIndex = '10005';
                            shop.style.background = 'rgba(255,255,255,0.95)';
                            shop.style.color = '#111';
                            shop.style.padding = '10px';
                            shop.style.borderRadius = '10px';
                            shop.style.boxShadow = '0 8px 24px rgba(0,0,0,0.15)';
                            shop.style.fontFamily = 'Segoe UI, Tahoma, sans-serif';
                            shop.innerHTML = `
                                <div style="font-weight:800;margin-bottom:6px;">CapyBrothers Shop</div>
                                <div style="font-size:13px;margin-bottom:8px;">Coins: <span id="capy-coin-count">${this.gameState.coins}</span></div>
                                <div style="display:flex;gap:8px;margin-bottom:8px;">
                                    <button id="buy-watermelon" style="flex:1;padding:8px;border-radius:8px;border:0;background:#4CAF50;color:white;cursor:pointer;">Buy Watermelon — 25¢</button>
                                </div>
                                <div style="font-size:12px;color:#666;">CapyBrothers build the town and earn coins; spend coins on fruit for your pets.</div>
                            `;
                            document.body.appendChild(shop);

                            // buy handler
                            shop.querySelector('#buy-watermelon').addEventListener('click', () => {
                                const cost = 25;
                                this.gameState.coins = this.gameState.coins || 0;
                                if (this.gameState.coins < cost) {
                                    if (this._announcementText) {
                                        this._announcementText.textContent = 'Not enough coins to buy Watermelon.';
                                        setTimeout(()=>{ this._announcementText.textContent = 'UPDATES MORE SOON!'; }, 1600);
                                    }
                                    return;
                                }
                                this.gameState.coins -= cost;
                                const coinEl = document.getElementById('capy-coin-count');
                                if (coinEl) coinEl.textContent = String(this.gameState.coins);
                                if (this._announcementText) {
                                    this._announcementText.textContent = 'Bought Watermelon — pets are happier!';
                                    setTimeout(()=>{ this._announcementText.textContent = 'UPDATES MORE SOON!'; }, 1600);
                                }
                                // spawn a watermelon near Cashy as a visual treat
                                try {
                                    const loader = new THREE.TextureLoader();
                                    // reuse DancingBanana texture as placeholder fruit if no fruit asset exists
                                    const tex = loader.load('/DancingBanana.gif');
                                    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
                                    const spr = new THREE.Sprite(mat);
                                    spr.scale.set(1.2,1.2,1);
                                    const pos = (this.world && this.world.cashy) ? this.world.cashy.position.clone().add(new THREE.Vector3(0,2,0)) : new THREE.Vector3(0,2,0);
                                    spr.position.copy(pos);
                                    if (this.world && this.world.scene) this.world.scene.add(spr);
                                    setTimeout(()=>{ try { if (this.world && this.world.scene) this.world.scene.remove(spr); } catch(e){} }, 8000);
                                } catch (e) {}
                            });
                        } else {
                            // update coin counter display
                            const coinEl = document.getElementById('capy-coin-count');
                            if (coinEl) coinEl.textContent = String(this.gameState.coins);
                            shop.style.display = 'block';
                        }

                        if (themeNote) themeNote.textContent = 'CapyBrothers theme applied: town builders produce coins & a shop is available.';
                        if (this._announcementText) { this._announcementText.textContent = 'Theme: CapyBrothers — collect coins & buy fruit!'; setTimeout(()=>{ this._announcementText.textContent='UPDATES MORE SOON!'; },1600); }
                    } catch (e) { console.warn('CapyBrothers theme apply failed', e); }
                    return;
                }

                // Mushroom Gnomes: spawn poisonous dart frogs roaming the map and enable a defense behavior that summons a poison-dart-frog army when triggered
                if (t === 'mushroomgnomes') {
                    try {
                        // Visuals: twilight forest with mushroom tint
                        this.scene.background = new THREE.Color(0x2b3a2a);
                        this.scene.fog = new THREE.FogExp2(0x2b3a2a, 0.03);

                        // Spawn decorative mushrooms (simple colored spheres) near player
                        try {
                            for (let i = 0; i < 18; i++) {
                                const cap = new THREE.Mesh(new THREE.SphereGeometry(0.18 + Math.random()*0.18, 8, 8), new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(Math.random()*0.2+0.1, 0.6, 0.5) }));
                                const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.03,0.03,0.28,6), new THREE.MeshStandardMaterial({ color: 0x9aa07a }));
                                const g = new THREE.Group();
                                cap.position.y = 0.28;
                                stalk.position.y = 0.1;
                                g.add(stalk, cap);
                                const ang = Math.random()*Math.PI*2;
                                const r = 4 + Math.random()*18;
                                const x = (this.world && this.world.playerPosition) ? this.world.playerPosition.x + Math.cos(ang)*r : Math.cos(ang)*r;
                                const z = (this.world && this.world.playerPosition) ? this.world.playerPosition.z + Math.sin(ang)*r : Math.sin(ang)*r;
                                g.position.set(x, 0, z);
                                this.scene.add(g);
                                // track small decoration so it can be cleaned later (best-effort)
                                this._mushroomDecor = this._mushroomDecor || [];
                                this._mushroomDecor.push(g);
                            }
                        } catch (e) {}

                        // Create a small theme shop toggle to "Enable Defense" which will summon a poison dart frog army (players should be warned)
                        let mgShop = document.getElementById('mushroomgnomes-shop');
                        if (!mgShop) {
                            mgShop = document.createElement('div');
                            mgShop.id = 'mushroomgnomes-shop';
                            mgShop.style.position = 'fixed';
                            mgShop.style.left = '18px';
                            mgShop.style.top = '220px';
                            mgShop.style.zIndex = '10005';
                            mgShop.style.background = 'rgba(0,0,0,0.7)';
                            mgShop.style.color = 'white';
                            mgShop.style.padding = '10px';
                            mgShop.style.borderRadius = '10px';
                            mgShop.style.boxShadow = '0 8px 24px rgba(0,0,0,0.15)';
                            mgShop.style.fontFamily = 'Segoe UI, Tahoma, sans-serif';
                            mgShop.innerHTML = `
                                <div style="font-weight:800;margin-bottom:6px;">Mushroom Gnomes</div>
                                <div style="font-size:13px;margin-bottom:8px;">Threat: Poison Dart Frogs (hostile)</div>
                                <div style="display:flex;gap:8px;">
                                    <button id="mg-defend-toggle" style="flex:1;padding:8px;border-radius:8px;border:0;background:#d32f2f;color:white;cursor:pointer;">Trigger Defense (Spawn Frog Army)</button>
                                    <button id="mg-clear" style="flex:1;padding:8px;border-radius:8px;border:0;background:#616161;color:white;cursor:pointer;">Clear</button>
                                </div>
                                <div style="font-size:12px;color:#ddd;margin-top:8px;">Warning: poison frogs are hostile to pets and players (frogs are immune).</div>
                            `;
                            document.body.appendChild(mgShop);

                            mgShop.querySelector('#mg-defend-toggle').addEventListener('click', () => {
                                // Spawn an aggressive poison dart frog army via world helper
                                try {
                                    if (this.world && typeof this.world.spawnPoisonDartFrogs === 'function') {
                                        this.world.spawnPoisonDartFrogs(12, { aggressive:true });
                                        if (this._announcementText) this._announcementText.textContent = 'Defense triggered — Poison Dart Frog army incoming!';
                                    }
                                } catch (e) { console.warn('Failed to spawn poison frogs', e); }
                            });
                            mgShop.querySelector('#mg-clear').addEventListener('click', () => {
                                try {
                                    if (this._mushroomDecor) { this._mushroomDecor.forEach(m => { try { this.scene.remove(m); } catch(e){} }); this._mushroomDecor.length = 0; }
                                    const shopEl = document.getElementById('mushroomgnomes-shop');
                                    if (shopEl) shopEl.remove();
                                } catch (e) {}
                            });
                        } else {
                            mgShop.style.display = 'block';
                        }

                        // spawn a small persistent population of territorial poison dart frogs that will reproduce over time
                        try {
                            if (this.world && typeof this.world.spawnPoisonDartFrogs === 'function') {
                                this.world.spawnPoisonDartFrogs(6, { aggressive:false, reproduce:true });
                            }
                        } catch (e) {}

                        if (themeNote) themeNote.textContent = 'Mushroom Gnomes applied: watch for poisonous dart frogs and mushroom decorations.';
                        if (this._announcementText) { this._announcementText.textContent = 'Theme: Mushroom Gnomes — poison dart frogs may roam!'; setTimeout(()=>{ this._announcementText.textContent='UPDATES MORE SOON!'; },1600); }
                    } catch (e) { console.warn('Mushroom Gnomes theme apply failed', e); }
                    return;
                }

                // Spring is locked (UI shows disabled); keep default if chosen accidentally
                if (t === 'spring') {
                    if (themeNote) themeNote.textContent = 'Spring is locked.';
                    if (this._announcementText) { this._announcementText.textContent = 'Theme: Spring is locked'; setTimeout(()=>{ this._announcementText.textContent='UPDATES MORE SOON!'; },1400); }
                    return;
                }

                // IShowThemes: summon Ishoweyes and make the map hostile; if player loses, a looping video overlay will play and UI is hidden
                if (t === 'ishowthemes') {
                    try {
                        // dramatic visuals
                        this.scene.background = new THREE.Color(0x050405);
                        this.scene.fog = new THREE.FogExp2(0x050405, 0.12);
                        this.gameState.isSurvival = true;
                        this.gameState.ishowTheme = true;
                        // spawn the unstoppable Ishoweyes boss
                        if (typeof this.spawnIshoweyesBoss === 'function') this.spawnIshoweyesBoss();
                        // force spawn allied bosses for pressure
                        try { if (typeof this.spawnJamesBoss === 'function') this.spawnJamesBoss(); } catch(e){}
                        try { if (typeof this.spawnTanBoss === 'function') this.spawnTanBoss(); } catch(e){}
                        // announce
                        if (this._announcementText) { this._announcementText.textContent = 'Theme: IShowThemes — an unstoppable presence looms...'; setTimeout(()=>{ this._announcementText.textContent='UPDATES MORE SOON!'; },2200); }
                    } catch (e) { console.warn('IShowThemes apply failed', e); }
                    if (themeNote) themeNote.textContent = 'IShowThemes applied: beware Ishoweyes and allied bosses.';
                    return;
                }
            };

            if (themeSelect) {
                themeSelect.addEventListener('change', (ev) => {
                    const val = themeSelect.value;
                    // ignore 'spring' since disabled option may be present in markup
                    if (val === 'spring') {
                        applyTheme('spring');
                        return;
                    }
                    applyTheme(val);
                });
            }
        } catch (e) { console.warn('Theme selector wiring failed', e); }

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
                        pets: this.gameState?.pets || 0,
                        // include campaign progress if present
                        campaign: this.campaignState || null
                    };
                    // Also persist a localStorage campaign save for quick resume
                    try {
                        if (snapshot.campaign) {
                            localStorage.setItem('capybara_campaign_save', JSON.stringify(snapshot.campaign));
                        }
                        // keep a general quick-save JSON as well
                        localStorage.setItem('capybara_quicksave', JSON.stringify(snapshot));
                    } catch (lsErr) {
                        console.warn('localStorage save failed', lsErr);
                    }

                    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `capybara_save_day${snapshot.day}.json`;
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    URL.revokeObjectURL(url);
                    this._announcementText.textContent = 'Saved game snapshot (local + download).';
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

        // Key handlers: F2/F8/F10 and E (player swap) + D to shoot + T for shop
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

            if (e.key === 'F8') {
                this._debugVisible = !this._debugVisible;
                this._debugOverlay.style.display = this._debugVisible ? 'block' : 'none';
                if (this._debugVisible) {
                    this._updateDebugInfo();
                }

                // Also build and download a "privated server patch" ZIP containing folders and tutorial files
                (async () => {
                    try {
                        const zip = new JSZip();
                        // Create folder structure
                        const rootFolder = zip.folder('Capybara_Garden_Patches');
                        const glbFolder = rootFolder.folder('glb');
                        const xdeltaFolder = rootFolder.folder('xdelta_patches');
                        const htmlFolder = rootFolder.folder('html');
                        const docsFolder = rootFolder.folder('docs');
                        const cfgFolder = rootFolder.folder('config');

                        // Placeholder GLB info file (actual .glb binary not embedded)
                        glbFolder.file('README.txt', 'Place your .glb model files here (do not include large binaries in the web ZIP). Example: samurai_capybara (1).glb\n');

                        // Placeholder xdelta notes
                        xdeltaFolder.file('README.txt', 'Place xdelta patch files here (.xdelta) to patch game assets. Example filenames: patch_001.xdelta\n');

                        // data.txt in root folder as requested (with explicit copyright / thanks)
                        rootFolder.file('data.txt', 'Patch metadata:\nname: Capybara Garden Privated Server Patch\nversion: 1.0\ncreated: ' + (new Date()).toISOString() + '\n\nCopyright: Yellower Games — 1960 - 2026\nNotes: This archive includes a folder for xdelta patches (xdelta_patches/) and sample tutorial HTML for safe installation.\n');

                        // Add config / CGPS files (user-editable flags)
                        const cgpsCfg = `# CGPS configuration (Capybara Garden Privated Server)\n# Enable/disable features with true/false\nmod = true\ndebug = spawn tall capybara = false\nopen = https://websim.com/@bigcontheyeshwebsim/capybara-garden-2\nversion = 1.0\nallow_updates = true\n`;
                        cfgFolder.file('CGPS.cfg', cgpsCfg);

                        // Also include a JSON-style manifest for automatic tools
                        const manifest = {
                            name: "Capybara Garden Privated Server Patch",
                            version: "1.0",
                            mod: true,
                            debug: { spawnTallCapybara: false },
                            source: "https://websim.com/@bigcontheyeshwebsim/capybara-garden-2",
                            created: (new Date()).toISOString(),
                            copyright: "Yellower Games — 1960 - 2026"
                        };
                        rootFolder.file('manifest.json', JSON.stringify(manifest, null, 2));

                        // Tutorial README
                        const tutorialReadme = `Capybara Garden Privated Server Patch - INSTALL & CONTENTS

This archive is a modder-friendly helper pack created for Capybara Garden (Privated Server Patch).
It includes folders for GLB model files, xdelta patch files, tutorial HTML, configuration (config/CGPS.cfg), and documentation.

INSTALL STEPS
1) Unzip this archive.
2) Edit config/CGPS.cfg as needed (enter 'true' or 'false' for boolean flags).
3) Copy your .glb model files into the 'glb' folder.
4) Apply any .xdelta patch files in 'xdelta_patches' using your xdelta tool:
   Example: xdelta3 -d -s original_file.dat patch_001.xdelta output_file.dat
5) Open html/tutorial_install.html for a guided walkthrough.
6) Place the 'Capybara_Garden_Patches' folder in a convenient location (e.g. %APPDATA%\\Capybara_Garden_Patches or ~/.config/Capybara_Garden_Patches).
7) Keep backups of original files before applying patches and follow troubleshooting steps if needed.

GUIDE: ENEMIES, PETS, OBJECTS
- Enemies: infectors dede (basic), King Infectors (boss), snow infectors (winter), sharks (island), jumping burrowers (dirt).
- Pets: Cashy, Builder G, Dancing Banana, Parrot, Baby Capybara (born 1960-01-16).
- Objects: Campfire, Castle, TimeG (videoframe), BuilderG sprite, Diamond pickups.
- Living objects: sprites with hp and bounce behaviors (pets and some npcs).
- Non-living objects: static meshes and environmental decor (bushes, flowers, house blueprints).

How to play (quick)
- Move: Hold mouse/touch to move your capybara.
- Interact: Approach pets/objects to pet or trigger events.
- Modes: Use teleport (Q) to move between maps (island, desert, nights, snow, etc).
- Survival: Stand near Builder G to activate defenses; kill enemies with D (shoot) or S (bomb).
- Campaign: Press X to toggle campaign mode (tutorial + 40 levels).
- To spawn special waves/tools use the in-game debug keys (F8 builds a patch zip; F10 spawn commands).

CREDITS & THANKS
Thanks to contributors and community. Special thanks to Yellower Games — 1960 - 2026.

`;
                        docsFolder.file('README.txt', tutorialReadme);

                        // Simple tutorial HTML that can be opened directly by clicking in file manager
                        const tutorialHtml = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>Capybara Garden Patch Tutorial</title>
<style>body{font-family:Arial,Helvetica,sans-serif;background:#f6f6f6;color:#111;padding:18px}h1{color:#2b6}pre{background:#222;color:#f8f8f8;padding:12px;border-radius:6px;overflow:auto}code{background:#eee;padding:2px 4px;border-radius:4px}</style>
</head>
<body>
<h1>Install Tutorial — Capybara Garden Patch</h1>
<p>This tutorial shows a basic, safe patch install flow. Edit config/CGPS.cfg to enable/disable mod/debug flags (enter true or false).</p>
<ol>
<li>Unzip the downloaded <strong>Capybara_Garden_Patches</strong> folder.</li>
<li>Edit <code>config/CGPS.cfg</code> if you need to change mod/debug flags.</li>
<li>Place GLB model files into the <code>glb/</code> folder.</li>
<li>If you have <code>.xdelta</code> patch files, use <code>xdelta3</code> to apply them to target files (example below).</li>
<li>Open the game and use the in-game mod tools or copy patched files into your game directory.</li>
</ol>
<h2>Quick Guide</h2>
<ul>
<li>Enemies are listed in docs/README.txt and spawn per-map.</li>
<li>Pets are interactive sprites; Baby Capybara intentionally has no pet sound.</li>
<li>Non-living objects should be placed under glb/ as appropriate.</li>
</ul>
<h2>Example xdelta command</h2>
<pre> xdelta3 -d -s original_file.dat patch_001.xdelta output_file.dat </pre>
</body>
</html>`;
                        htmlFolder.file('tutorial_install.html', tutorialHtml);

                        // Add a small install helper HTML (play.html) that instructs to click to open tutorial
                        const playHtml = `<!doctype html>
<html><head><meta charset="utf-8"><title>Capybara Patch Play</title></head>
<body style="font-family:Arial,Helvetica,sans-serif;padding:18px">
<h2>Capybara Garden Patch Helper</h2>
<p>Click to open the tutorial included with this patch:</p>
<ul>
<li><a href="./html/tutorial_install.html" target="_blank">Open Install Tutorial (tutorial_install.html)</a></li>
<li>Configuration: <a href="./config/CGPS.cfg" target="_blank">config/CGPS.cfg</a></li>
</ul>
</body></html>`;
                        htmlFolder.file('play.html', playHtml);

                        // Add an explicit install steps file for quick reading (install_steps.html)
                        htmlFolder.file('install_steps.html', '<!doctype html><html><body><h1>Quick Install Steps</h1><ol><li>Unzip</li><li>Edit config/CGPS.cfg (enter true/false)</li><li>Copy models/patches</li><li>Place folder in AppData path</li><li>Launch game</li></ol></body></html>');

                        // Add a THANKS file and legal note
                        rootFolder.file('README_THANKS.txt', 'Thanks to all contributors and supporters. Yellower Games — 1960 - 2026');

                        // Generate the zip blob and trigger download
                        const content = await zip.generateAsync({ type: 'blob' });
                        const url = URL.createObjectURL(content);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = 'Capybara_Garden_Privated_Server_Patch.zip';
                        document.body.appendChild(a);
                        a.click();
                        a.remove();
                        URL.revokeObjectURL(url);

                        // notify user in-app
                        if (this._announcementText) {
                            this._announcementText.textContent = 'Patch ZIP built and downloading (F8) — config included';
                            setTimeout(() => { try { this._announcementText.textContent = 'UPDATES MORE SOON!'; } catch(e){} }, 2500);
                        }
                    } catch (err) {
                        console.error('Patch ZIP build failed', err);
                        if (this._announcementText) {
                            this._announcementText.textContent = 'Failed to build patch ZIP.';
                            setTimeout(() => { try { this._announcementText.textContent = 'UPDATES MORE SOON!'; } catch(e){} }, 2500);
                        }
                    }
                })();

                return;
            }



            // F10: quick spawn command prompt — ask what to spawn and handle "infectors dede" / myth variant / bosses
            if (e.key === 'F10') {
                try {
                    // Quick-spawn via F10 is considered a potential cheat; block if noCheat enabled
                    if (this.noCheat) {
                        try { if (this._announcementText) this._announcementText.textContent = 'Quick spawns disabled: no cheating allowed.'; } catch(e){}
                        return;
                    }
                    const choice = window.prompt('F10 Spawn — what do you spawn? (e.g. infectors dede, myth infectors, banana, bosses)', 'infectors dede');
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

                    // Special "bosses" shortcut: spawn a boss wave (James, Tan, Ishoweyes) plus allied sieges
                    if (cmd === 'bosses' || cmd.includes('bosses') || cmd.includes('all bosses')) {
                        try {
                            // spawn major bosses if their spawn functions exist
                            if (typeof this.spawnJamesBoss === 'function') this.spawnJamesBoss();
                            if (typeof this.spawnTanBoss === 'function') this.spawnTanBoss();
                            // spawn many Ishoweyes instances where possible (best-effort)
                            const ishowCount = 6;
                            for (let i = 0; i < ishowCount; i++) {
                                try {
                                    // stagger spawns slightly around the player
                                    const angle = Math.random() * Math.PI * 2;
                                    const r = 6 + Math.random() * 18;
                                    const pos = this.player.mesh.position.clone().add(new THREE.Vector3(Math.cos(angle) * r, 0, Math.sin(angle) * r));
                                    // reuse spawnIshoweyesBoss if available, otherwise duplicate minimal behavior
                                    if (typeof this.spawnIshoweyesBoss === 'function') {
                                        this.spawnIshoweyesBoss();
                                        // nudge the last spawned boss near the chosen position if possible
                                        if (this._ishBoss && this._ishBoss.mesh) {
                                            try { this._ishBoss.mesh.position.copy(pos.clone().add(new THREE.Vector3(0, 6, -6))); } catch(e){}
                                        }
                                    } else {
                                        // fallback: create a sprite that mimics Ishoweyes
                                        const tex = new THREE.TextureLoader().load('/ishoweyes.jpeg');
                                        const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
                                        const sprite = new THREE.Sprite(mat);
                                        sprite.scale.set(7,7,1);
                                        sprite.position.copy(pos.clone().add(new THREE.Vector3(0,6,-6)));
                                        this.scene.add(sprite);
                                        const fake = { name: 'Ishoweyes (fallback)', alive: true, mesh: sprite, update: (tp,dt)=>{}, destroy: ()=>{ try{ this.scene.remove(sprite); }catch(e){} } };
                                        this.enemies.push(fake);
                                    }
                                } catch (e) { console.warn('Failed to spawn an Ishoweyes instance', e); }
                            }

                            // spawn a robust castle siege and allied waves
                            if (typeof this.spawnCastleInfectors === 'function') this.spawnCastleInfectors(36);
                            // spawn sharks and spiders for variety
                            if (typeof this.spawnSharkArmy === 'function') this.spawnSharkArmy(8);

                            // spawn The Ruined Ones boss to trigger its prompt/effects
                            if (typeof this.spawnRuinedOnes === 'function') this.spawnRuinedOnes();

                            // create additional standard enemies around player for immediate pressure
                            const p = this.player.mesh.position.clone();
                            for (let i = 0; i < 36; i++) {
                                const angle = Math.random() * Math.PI * 2;
                                const r = 6 + Math.random() * 28;
                                const spawnPos = new THREE.Vector3(p.x + Math.cos(angle) * r, 0, p.z + Math.sin(angle) * r);
                                this.enemies.push(new Enemy(this.scene, spawnPos));
                            }

                            // Start a repeating taunt: update announcement text and attempt a short TTS loop calling the builder voice helper
                            try {
                                if (this._bossesSpamInterval) clearInterval(this._bossesSpamInterval);
                                // immediately show message once
                                if (this._announcementText) this._announcementText.textContent = "You're cooked hahahahahaha";
                                // start interval to repeat message and attempt TTS every 2.4s
                                this._bossesSpamInterval = setInterval(() => {
                                    try {
                                        if (this._announcementText) this._announcementText.textContent = "You're cooked hahahahahaha";
                                        // try a short builder-voice TTS if available
                                        try { this.playBuilderGVoice && this.playBuilderGVoice("You're cooked. Hahahahahaha"); } catch(e){}
                                    } catch (e) {}
                                }, 2400);
                            } catch (e) { console.warn('Failed to start bosses spam interval', e); }

                            if (this._announcementText) {
                                this._announcementText.textContent = 'BOSSES: Multiple bosses, many Ishoweyes, and The Ruined Ones have been summoned!';
                                setTimeout(() => { this._announcementText.textContent = 'UPDATES MORE SOON!'; }, 3200);
                            }
                            if (this.alertsEnabled) this.playSound('day');
                        } catch (err) {
                            console.warn('Failed to spawn bosses via F10', err);
                            if (this._announcementText) {
                                this._announcementText.textContent = 'Failed to spawn bosses (see console).';
                                setTimeout(() => { this._announcementText.textContent = 'UPDATES MORE SOON!'; }, 2200);
                            }
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

            // T: open shop (buy/equip skins)
            if (e.key.toLowerCase() === 't') {
                try {
                    // Simple shop UI via prompt
                    const shopMenu = `SHOP - Skins\nYou have ${this.gameState.diamonds} diamonds.\n1) Samurai Capybara — 50 diamonds\nType "buy samurai" to purchase or "equip samurai" to wear (if owned), or "cancel".`;
                    const choice = window.prompt(shopMenu, 'buy samurai');
                    if (!choice) return;
                    const cmd = String(choice).trim().toLowerCase();

                    if (cmd === 'buy samurai' || cmd === 'buy samurai capybara') {
                        if (this.gameState.ownedSkins && this.gameState.ownedSkins.samurai) {
                            this._announcementText.textContent = 'You already own Samurai Capybara.';
                            setTimeout(() => { this._announcementText.textContent = 'UPDATES MORE SOON!'; }, 1600);
                            return;
                        }
                        const cost = 50;
                        if ((this.gameState.diamonds || 0) < cost) {
                            this._announcementText.textContent = 'Not enough diamonds to buy Samurai Capybara.';
                            setTimeout(() => { this._announcementText.textContent = 'UPDATES MORE SOON!'; }, 1600);
                            return;
                        }
                        this.gameState.diamonds -= cost;
                        this.gameState.ownedSkins = this.gameState.ownedSkins || {};
                        this.gameState.ownedSkins.samurai = true;
                        this._announcementText.textContent = 'Purchased Samurai Capybara! It is now equipped.';
                        // auto-equip after purchase
                        this.gameState.equippedSkin = 'samurai';
                        // load and apply model
                        if (!this._gltfLoader) this._gltfLoader = new GLTFLoader();
                        const modelPath = '/samurai_capybara (1).glb';
                        this._gltfLoader.load(modelPath, (gltf) => {
                            try {
                                if (this.player && this.player.mesh) {
                                    try { this.scene.remove(this.player.mesh); } catch(e){}
                                }
                                const g = new THREE.Group();
                                g.add(gltf.scene);
                                const bbox = new THREE.Box3().setFromObject(g);
                                const size = new THREE.Vector3();
                                bbox.getSize(size);
                                const maxDim = Math.max(size.x, size.y, size.z) || 1;
                                const scale = 1.5 / maxDim;
                                g.scale.setScalar(scale);
                                g.position.copy(this.player?.mesh?.position || new THREE.Vector3(0,0,0));
                                g.position.y = 0;
                                g.castShadow = true;
                                this.player.mesh = g;
                                this.scene.add(this.player.mesh);
                                if (this.world) this.world.playerPosition = this.player.mesh.position;
                            } catch (err) {
                                console.warn('Failed to equip Samurai Capybara', err);
                                this._announcementText.textContent = 'Purchased but failed to equip model.';
                            }
                        }, undefined, (err) => {
                            console.error('Samurai GLTF load error', err);
                            this._announcementText.textContent = 'Purchase succeeded but model failed to load.';
                        });

                        setTimeout(() => { this._announcementText.textContent = 'UPDATES MORE SOON!'; }, 2200);
                        return;
                    }

                    if (cmd === 'equip samurai' || cmd === 'equip samurai capybara') {
                        if (!(this.gameState.ownedSkins && this.gameState.ownedSkins.samurai)) {
                            this._announcementText.textContent = 'You do not own Samurai Capybara. Buy it first.';
                            setTimeout(() => { this._announcementText.textContent = 'UPDATES MORE SOON!'; }, 1600);
                            return;
                        }
                        this.gameState.equippedSkin = 'samurai';
                        if (!this._gltfLoader) this._gltfLoader = new GLTFLoader();
                        const modelPathE = '/samurai_capybara (1).glb';
                        this._announcementText.textContent = 'Equipping Samurai Capybara...';
                        this._gltfLoader.load(modelPathE, (gltf) => {
                            try {
                                if (this.player && this.player.mesh) {
                                    try { this.scene.remove(this.player.mesh); } catch(e){}
                                }
                                const g = new THREE.Group();
                                g.add(gltf.scene);
                                const bbox = new THREE.Box3().setFromObject(g);
                                const size = new THREE.Vector3();
                                bbox.getSize(size);
                                const maxDim = Math.max(size.x, size.y, size.z) || 1;
                                const scale = 1.5 / maxDim;
                                g.scale.setScalar(scale);
                                g.position.copy(this.player?.mesh?.position || new THREE.Vector3(0,0,0));
                                g.position.y = 0;
                                g.castShadow = true;
                                this.player.mesh = g;
                                this.scene.add(this.player.mesh);
                                if (this.world) this.world.playerPosition = this.player.mesh.position;
                                this._announcementText.textContent = 'Samurai Capybara equipped.';
                                setTimeout(() => { this._announcementText.textContent = 'UPDATES MORE SOON!'; }, 1600);
                            } catch (err) {
                                console.warn('Failed to equip Samurai Capybara', err);
                                this._announcementText.textContent = 'Failed to equip model.';
                                setTimeout(() => { this._announcementText.textContent = 'UPDATES MORE SOON!'; }, 1600);
                            }
                        }, undefined, (err) => {
                            console.error('Samurai GLTF load error', err);
                            this._announcementText.textContent = 'Failed to load Samurai model.';
                            setTimeout(() => { this._announcementText.textContent = 'UPDATES MORE SOON!'; }, 1600);
                        });
                        return;
                    }

                    // cancel or unknown
                    this._announcementText.textContent = 'Shop closed.';
                    setTimeout(() => { this._announcementText.textContent = 'UPDATES MORE SOON!'; }, 900);
                } catch (err) {
                    console.warn('T key shop handler error', err);
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

                        // Track whether we hit Fan Oise specifically
                        let fanOiseHit = false;

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
                                    // if this enemy is Fan Oise (sprite userData), flag special behavior
                                    try {
                                        if (en.mesh && en.mesh.userData && en.mesh.userData.isFanOise) {
                                            fanOiseHit = true;
                                        }
                                    } catch (ee) {}
                                    // destroy enemy (normal behavior)
                                    try { en.destroy(); } catch (err) {
                                        if (en.mesh) try { this.scene.remove(en.mesh); } catch(e){}
                                    }
                                    hits++;
                                }
                            } catch (err) {}
                        }

                        // play a shooting/bomb sound to indicate hit
                        if (this.alertsEnabled) this.playSound('bomb');

                        // if fan oise was hit, trigger its special sequence (GDI glitch + beat loop, pets vanish, fan chases faster)
                        try {
                            if (fanOiseHit) {
                                try {
                                    // call sequence helper on this game instance
                                    if (typeof this._triggerFanOiseSequence === 'function') this._triggerFanOiseSequence();
                                } catch (seqErr) { console.warn('Fan Oise sequence failed', seqErr); }
                            }
                        } catch (e) {}

                        if (this._announcementText) {
                            this._announcementText.textContent = `Shot fired${hits ? ' — hits: ' + hits : ''}${fanOiseHit ? ' — Fan Oise hit!' : ''}`;
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

            // Start intense chase music for the fast infectors wave (looped). Stop after 45s.
            try {
                // Use existing "jelly" music (buckwheat jelly) as chase music; play only if not already playing
                if (this.alertsEnabled) {
                    this.playSound('jelly');
                    // clear any previous chase timer
                    try { if (this._chaseTimeout) clearTimeout(this._chaseTimeout); } catch(e){}
                    this._chaseTimeout = setTimeout(() => {
                        try { this.stopJelly(); } catch(e){}
                        this._chaseTimeout = null;
                    }, 45000); // 45 seconds
                }
            } catch (e) {
                console.warn('Failed to start chase music', e);
            }
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

        this.animate = this.animate.bind(this);

        // Nights wave helper: spawn waves for campfire nights mode
        this._startNightsWave = () => {
            try {
                if (!this.gameState) return;
                if (!this.gameState.nightsMode) return;
                this.gameState.nightsWaveInProgress = true;
                this.gameState.nightsWave = (this.gameState.nightsWave || 0) + 1;
                const waveNumber = this.gameState.nightsWave;
                // scale enemies by wave number
                const count = 4 + Math.floor(waveNumber * 3);
                this.gameState.nightsEnemiesRemaining = count;
                // spawn around campfire
                const center = (this._campfireGroup ? this._campfireGroup.position.clone() : this.player.mesh.position.clone());
                for (let i = 0; i < count; i++) {
                    const angle = Math.random() * Math.PI * 2;
                    const r = 6 + Math.random() * 10;
                    const spawnPos = new THREE.Vector3(center.x + Math.cos(angle) * r, 0, center.z + Math.sin(angle) * r);
                    const en = new Enemy(this.scene, spawnPos);
                    // make enemies slightly more aggressive at night
                    try { en.speed = (en.speed || 2.5) * (1 + waveNumber * 0.08); } catch(e){}
                    // on destroy, decrement remaining (monkey-patch destroy)
                    const originalDestroy = en.destroy.bind(en);
                    en.destroy = () => {
                        try { originalDestroy(); } catch(e){}
                        try {
                            this.gameState.nightsEnemiesRemaining = Math.max(0, (this.gameState.nightsEnemiesRemaining || 1) - 1);
                        } catch (err) {}
                        // if last enemy of wave, mark wave complete after short delay
                        if ((this.gameState.nightsEnemiesRemaining || 0) <= 0) {
                            setTimeout(() => {
                                this.gameState.nightsWaveInProgress = false;
                                // if more waves remain, wait a short rest then start next wave automatically
                                if ((this.gameState.nightsWave || 0) < (this.gameState.nightsWavesTotal || 0)) {
                                    setTimeout(() => { if (this.gameState.nightsMode) this._startNightsWave(); }, 3000);
                                }
                            }, 600);
                        }
                    };
                    this.enemies.push(en);
                }
                // message
                if (this._announcementText) {
                    this._announcementText.textContent = `Night ${waveNumber} — ${count} attackers incoming!`;
                    setTimeout(() => { try { this._announcementText.textContent = 'UPDATES MORE SOON!'; } catch(e){} }, 3000);
                }
                // play alert
                if (this.alertsEnabled) this.playSound('day');
            } catch (e) {
                console.warn('Failed to start nights wave', e);
                this.gameState.nightsWaveInProgress = false;
            }
        };

        // Create a simple credits toggle bound to 'H' (replaces any F5 behavior)
        try {
            // ensure credits element exists (in case index.html was updated)
            const creditsEl = document.getElementById('credits-overlay');
            const creditsClose = document.getElementById('credits-close');
            if (creditsClose) creditsClose.addEventListener('click', () => { if (creditsEl) creditsEl.style.display = 'none'; });

            window.addEventListener('keydown', (ev) => {
                // Toggle on 'h' or 'H'
                if (ev.key && (ev.key === 'h' || ev.key === 'H')) {
                    if (!creditsEl) return;
                    creditsEl.style.display = (creditsEl.style.display === 'flex' || creditsEl.style.display === 'block') ? 'none' : 'flex';
                    // use flex centering style; ensure focusability removed
                    if (creditsEl.style.display === 'flex') {
                        creditsEl.style.display = 'flex';
                        // optionally pause game while credits visible
                        this.paused = true;
                    } else {
                        this.paused = false;
                    }
                }
            });
        } catch (e) {
            console.warn('Credits toggle init failed', e);
        }

        requestAnimationFrame(this.animate);

        window.addEventListener('resize', () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        });
    }

    async loadSounds() {
        const soundFiles = {
            plant: 'plant_sound.mp3',
            day: 'day_change.mp3',
            jelly: 'buckwheat-boyz-peanut-butter-jelly-time.mp3',
            // boss/spider music (uses jelly as placeholder)
            spider: 'buckwheat-boyz-peanut-butter-jelly-time.mp3',
            // special Ishoweyes boss music
            ishoweyes: 'I-found-Ishoweyes.mp3',
            // Field of Ambush - chapter 2 finale music
            field: 'Fieldofambush.mp3.mpeg.wav',
            // Evil Capybara boss theme (glitchy, long, byte-bits)
            evilcapy: 'evil_capybara_theme.mp3',
            // tutorial music for Practice Mode (short loop)
            tutorial: 'pet_sound.mp3',
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
        // Respect global mute toggle
        if (this.soundsMuted) return;

        // Preferred: use decoded AudioBuffer if available
        const buffer = this.sounds ? this.sounds[name] : null;

        // Ensure AudioContext is running when using WebAudio
        const tryResumeAudioContext = async () => {
            if (this.audioContext && this.audioContext.state === 'suspended') {
                try { await this.audioContext.resume(); } catch (e) {}
            }
        };

        // For the jelly song, keep a single looping source so it doesn't restart repeatedly
        if (name === 'jelly' || name === 'evilcapy') {
            // If we have a decoded buffer, play via AudioContext loop
            if (buffer && this.audioContext) {
                const sourceKey = (name === 'jelly') ? 'jellySource' : 'evilCapySource';
                if (this[sourceKey]) return; // already playing
                try {
                    tryResumeAudioContext();
                    const source = this.audioContext.createBufferSource();
                    source.buffer = buffer;
                    source.loop = true;
                    source.connect(this.audioContext.destination);
                    source.start(0);
                    this[sourceKey] = source;
                    return;
                } catch (e) {
                    console.warn('WebAudio loop failed for', name, e);
                }
            }
            // Fallback: HTMLAudio element loop
            try {
                if (!this._htmlAudioSources) this._htmlAudioSources = {};
                if (this._htmlAudioSources[name]) return; // already playing
                const srcMap = {
                    jelly: 'buckwheat-boyz-peanut-butter-jelly-time.mp3',
                    evilcapy: 'evil_capybara_theme.mp3'
                };
                const a = new Audio(srcMap[name] || 'buckwheat-boyz-peanut-butter-jelly-time.mp3');
                a.loop = true;
                a.volume = 0.9;
                a.play().catch(()=>{});
                this._htmlAudioSources[name] = a;
            } catch (e) {}
            return;
        }

        // If we have a decoded buffer and AudioContext, play with WebAudio
        if (buffer && this.audioContext) {
            try {
                tryResumeAudioContext();
                const source = this.audioContext.createBufferSource();
                source.buffer = buffer;
                source.connect(this.audioContext.destination);
                source.start(0);
                return;
            } catch (e) {
                console.warn('WebAudio play failed, falling back to HTMLAudio', e);
            }
        }

        // Fallback: use HTMLAudio for one-shot sounds if WebAudio not available or buffer missing
        try {
            if (!this._htmlAudioCache) this._htmlAudioCache = {};
            // Map logical names to file paths (same as loadSounds mapping)
            const fallbackMap = {
                plant: 'plant_sound.mp3',
                day: 'day_change.mp3',
                jelly: 'buckwheat-boyz-peanut-butter-jelly-time.mp3',
                ishoweyes: 'I-found-Ishoweyes.mp3',
                bomb: 'plant_sound.mp3',
                christmas: 'christmas_song.mp3'
            };
            const src = fallbackMap[name] || fallbackMap['day'];
            // reuse element briefly to prevent spam
            const a = new Audio(src);
            a.volume = 1.0;
            a.play().catch(()=>{});
            // keep reference briefly to avoid garbage collection hiccups
            this._htmlAudioCache[name] = a;
            setTimeout(() => { try { delete this._htmlAudioCache[name]; } catch(e){} }, 3000);
        } catch (e) {
            // silent fail
            console.warn('Fallback HTMLAudio failed for', name, e);
        }
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
            window.removeEventListener('touchstart', unlockAudio);
            window.removeEventListener('mousedown', unlockAudio);
        };
        window.addEventListener('touchstart', unlockAudio, { once: true });
        window.addEventListener('mousedown', unlockAudio, { once: true });

        if (isMobile && typeof nipplejs !== 'undefined') {
            // Ensure the mobile-controls container exists and is sized for the joystick
            const zone = document.getElementById('mobile-controls') || (() => {
                const el = document.createElement('div');
                el.id = 'mobile-controls';
                el.style.position = 'absolute';
                el.style.bottom = '40px';
                el.style.right = '40px';
                el.style.width = '120px';
                el.style.height = '120px';
                el.style.touchAction = 'none';
                el.style.display = 'block';
                document.body.appendChild(el);
                return el;
            })();

            // Only show the mobile joystick controls on actual mobile devices
            try { zone.style.display = 'block'; } catch(e){}

            // Create a static joystick centered in the zone for predictable control
            const rect = zone.getBoundingClientRect();
            const joystick = nipplejs.create({
                zone,
                mode: 'static',
                position: { left: `${rect.width / 2}px`, top: `${rect.height / 2}px` },
                color: '#ffffff',
                size: Math.min(120, Math.max(80, Math.min(rect.width, rect.height))),
                restOpacity: 0.6
            });

            // Map nipple vector to input with a small deadzone and smoothing
            let lastX = 0, lastY = 0;
            const smooth = (v, last) => last * 0.7 + v * 0.3;

            joystick.on('move', (evt, data) => {
                if (!data || !data.vector) return;
                // apply deadzone to avoid tiny drift
                const dx = Math.abs(data.vector.x) < 0.08 ? 0 : data.vector.x;
                const dy = Math.abs(data.vector.y) < 0.08 ? 0 : data.vector.y;
                lastX = smooth(dx, lastX);
                lastY = smooth(-dy, lastY); // invert y to match game input convention
                this.input.x = lastX;
                this.input.y = lastY;
                this.input.isDown = true;
            });

            joystick.on('end', () => {
                // release movement smoothly
                this.input.isDown = false;
                lastX = 0;
                lastY = 0;
                this.input.x = 0;
                this.input.y = 0;
            });

            // also support tapping the zone to toggle isDown for simple move intent
            zone.addEventListener('touchstart', (ev) => {
                ev.preventDefault();
                this.input.isDown = true;
            }, { passive: false });
            zone.addEventListener('touchend', (ev) => {
                ev.preventDefault();
                this.input.isDown = false;
            }, { passive: false });
        } else {
            // Desktop controls: mouse to point / click to move
            window.addEventListener('mousedown', () => this.input.isDown = true);
            window.addEventListener('mouseup', () => this.input.isDown = false);
            window.addEventListener('mousemove', (e) => {
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
            // Support programmatic teleport overrides (menu buttons set window._teleportOverride)
            let dest = null;
            try {
                if (window._teleportOverride) {
                    dest = String(window._teleportOverride);
                    // clear override so subsequent Q behaves normally
                    window._teleportOverride = null;
                } else {
                    // fallback to prompt if no override
                    dest = window.prompt("What do you want to teleport? (e.g. desert, foggy, dark, island)", "island");
                }
            } catch (err) {
                try { dest = window.prompt("What do you want to teleport? (e.g. desert, foggy, dark, island)", "island"); } catch(e){ dest = null; }
            }
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

            // lightweight CASTLE-MAP view (map-only): do not start house-building flow or reposition player significantly
            if (d === 'castle-map') {
                try {
                    // Keep player in place (or slightly adjust to center view), but do not trigger chapter/build flows
                    try {
                        // gently move camera target area without forcing the chapter build flow
                        // position player near map center but preserve main player control
                        const viewPos = this.player.mesh.position.clone(); // preserve current pos
                        // set scene sky to a pleasant blue and refresh vegetation (remake grass)
                        this.scene.background = new THREE.Color(0x87CEEB); // sky blue
                        this.scene.fog = new THREE.FogExp2(0x87CEEB, 0.02);
                        if (this.world && typeof this.world.rebuildVegetation === 'function') {
                            // force a vegetation rebuild to "remake grass"
                            this.world.settings.vegetation = true;
                            this.world.rebuildVegetation();
                        }
                    } catch (innerErr) { console.warn('castle-map visuals failed', innerErr); }

                    // Instructions for map-only view
                    const instr = document.getElementById('instructions');
                    if (instr) {
                        instr.innerHTML = "CASTLE MAP (Map-Only) — Sky refreshed to blue; grass remade. No house-building flow activated.";
                        instr.style.background = "rgba(0,0,0,0.45)";
                    }

                    if (this._announcementText) {
                        this._announcementText.textContent = 'Chapter 2 Map loaded (map-only): sky set to blue and grass remade.';
                        setTimeout(()=>{ try{ this._announcementText.textContent='UPDATES MORE SOON!'; }catch(e){} }, 1800);
                    }
                } catch (err) {
                    console.warn('Castle-map teleport failed', err);
                }
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
                            const tex = new THREE.TextureLoader().load('/channels4_profile (6).jpg');
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

                    // If Chapter 2 is unlocked, start the 4-day house build mini-flow (short days for demo)
                    try {
                        if (this.achievements && this.achievements.chapter2Unlocked) {
                            // Initialize chapter-2 build flow
                            this.gameState.chapter2Building = true;
                            this.gameState.chapter2DaysTarget = 4;
                            this.gameState.day = 1;
                            // fast short days so it completes in roughly 4 * ~6s
                            this.gameState.dayDuration = 6; // seconds per day in this build flow
                            this.gameState.timer = 0;
                            if (this._announcementText) {
                                this._announcementText.textContent = 'Chapter 2: House Building — 4 short days of construction started.';
                                setTimeout(()=>{ try{ this._announcementText.textContent='UPDATES MORE SOON!'; }catch(e){} }, 2200);
                            }
                        } else {
                            // Brief delay then spawn the castle siege (uses existing spawnCastleInfectors)
                            setTimeout(() => {
                                try {
                                    this.spawnCastleInfectors(28);
                                } catch (e) {
                                    console.warn('spawnCastleInfectors error', e);
                                }
                            }, 1200);
                        }
                    } catch (e) {
                        console.warn('Chapter2 build flow check failed', e);
                    }

                    // Play dramatic alert chime
                    if (this.alertsEnabled) this.playSound('day');
                } catch (err) {
                    console.warn('Castle teleport failed', err);
                }
                return;
            }

            // YELLOWER TOWN SP — NPC dialog & falling-enemies survival challenge
            if (d === 'yellower' || d === 'yellower town' || d === 'yellower town sp') {
                try {
                    // Move player to Yellower town coordinates
                    this.player.mesh.position.set(8, 0, 6);
                    if (this.world) this.world.playerPosition = this.player.mesh.position;

                    // Hide friends/peer sprites in this map (soft disable)
                    try {
                        if (this.peerSprites) {
                            Object.keys(this.peerSprites).forEach(id => {
                                try { this.scene.remove(this.peerSprites[id]); } catch(e) {}
                            });
                        }
                        const peerCountEl = document.getElementById('peer-count');
                        if (peerCountEl) peerCountEl.textContent = '0';
                    } catch(e){}

                    // Map visuals: slight foggy, dusk tint
                    try {
                        this.scene.background = new THREE.Color(0x6f7a82);
                        this.scene.fog = new THREE.FogExp2(0x6f7a82, 0.03);
                    } catch(e){}

                    // Create a simple Yellower NPC sprite (or reuse YELLOWER.png if available)
                    if (!this._yellowerNpc) {
                        try {
                            const tex = new THREE.TextureLoader().load('/YELLOWER.png');
                            const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
                            const npc = new THREE.Sprite(mat);
                            npc.scale.set(2.2, 2.2, 1);
                            npc.position.set(10, 1.2, 6);
                            npc.name = 'YellowerNPC';
                            this._yellowerNpc = npc;
                            this.scene.add(npc);
                        } catch(e){
                            console.warn('Failed to create Yellower NPC', e);
                        }
                    }

                    // Dialogue overlay UI
                    const showYellowerDialog = () => {
                        // create dialog container if missing
                        let dlg = document.getElementById('yellower-dialog');
                        if (!dlg) {
                            dlg = document.createElement('div');
                            dlg.id = 'yellower-dialog';
                            dlg.style.position = 'fixed';
                            dlg.style.left = '50%';
                            dlg.style.top = '18%';
                            dlg.style.transform = 'translateX(-50%)';
                            dlg.style.zIndex = '10003';
                            dlg.style.background = 'rgba(255,255,255,0.95)';
                            dlg.style.padding = '12px 14px';
                            dlg.style.borderRadius = '10px';
                            dlg.style.boxShadow = '0 8px 24px rgba(0,0,0,0.25)';
                            dlg.style.maxWidth = '420px';
                            dlg.style.fontFamily = 'Segoe UI, Tahoma, sans-serif';
                            dlg.innerHTML = `
                                <div style="font-weight:800;margin-bottom:8px;">Yellower</div>
                                <div id="yellower-lines" style="font-size:13px;color:#222;line-height:1.4;margin-bottom:10px;">
                                    Yellower: Who are you dude?<br>
                                    Capy: I'm Capybara<br>
                                    Yellower: Woah you don't appear from this map.<br>
                                    Capy: What? I ain't no way.<br>
                                    Yellower: What do you want Capybara?
                                </div>
                                <div style="display:flex;gap:8px;justify-content:center;">
                                    <button id="yellower-approve" style="padding:8px 12px;border-radius:8px;border:0;background:#4CAF50;color:white;cursor:pointer;">Yes / Approve</button>
                                    <button id="yellower-decline" style="padding:8px 12px;border-radius:8px;border:0;background:#f44336;color:white;cursor:pointer;">No</button>
                                </div>
                            `;
                            document.body.appendChild(dlg);
                        } else {
                            dlg.style.display = 'block';
                        }

                        document.getElementById('yellower-approve').onclick = () => {
                            try { document.getElementById('yellower-dialog').style.display = 'none'; } catch(e){}
                            // start falling-enemies survival challenge: 50s, player HP 100
                            this.gameState.survivalFalling = true;
                            this.gameState.survivalFallingTime = 50; // seconds
                            this.gameState.playerHP = 100;
                            // ensure instructions update
                            const instr = document.getElementById('instructions');
                            if (instr) instr.innerHTML = "YELLOWER CHALLENGE — Survive 50s: avoid falling enemies!";
                            // play alert
                            if (this.alertsEnabled) this.playSound('day');
                        };

                        document.getElementById('yellower-decline').onclick = () => {
                            try { document.getElementById('yellower-dialog').style.display = 'none'; } catch(e){}
                            const instr = document.getElementById('instructions');
                            if (instr) instr.innerHTML = "You declined Yellower's challenge. Explore the map.";
                        };
                    };

                    // Show dialog when player approaches NPC or immediately
                    // We'll show immediately to prompt the user
                    showYellowerDialog();
                } catch (err) {
                    console.warn('Yellower teleport failed', err);
                }
                return;
            }

            // CURSED WORLD MAP — THE MOUTHY BOSS (throws fireballs that can kill player)
            if (d === 'cursed' || d === 'cursed world' || d === 'cursed map') {
                try {
                    // Teleport player to cursed arena coordinates
                    this.player.mesh.position.set(0, 0, -45);
                    if (this.world) this.world.playerPosition = this.player.mesh.position;

                    // Visuals: sickly dark-green sky, thick fog
                    try {
                        this.scene.background = new THREE.Color(0x071a12);
                        this.scene.fog = new THREE.FogExp2(0x071a12, 0.08);
                    } catch (err) { console.warn(err); }

                    // Instructions UI
                    const instr = document.getElementById('instructions');
                    if (instr) {
                        instr.innerHTML = "CURSED WORLD — Face THE MOUTHY! Avoid its fireballs or you'll be killed.";
                        instr.style.background = "rgba(80,0,0,0.85)";
                    }

                    // Create an arena ground marker (non-destructive)
                    if (!this._cursedArena) {
                        const arenaMat = new THREE.MeshStandardMaterial({ color: 0x1b3326, transparent: true, opacity: 0.95 });
                        const arena = new THREE.Mesh(new THREE.CircleGeometry(18, 32), arenaMat);
                        arena.rotation.x = -Math.PI / 2;
                        arena.position.set(0, 0.02, -45);
                        this._cursedArena = arena;
                        this.scene.add(this._cursedArena);
                    } else {
                        this._cursedArena.position.set(0, 0.02, -45);
                    }

                    // Spawn the Mouthy boss if not already present
                    if (!this._mouthyBoss || !this._mouthyBoss.alive) {
                        try {
                            const tex = new THREE.TextureLoader().load('/The Mouthy.png');
                            const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
                            const sprite = new THREE.Sprite(mat);
                            sprite.scale.set(6, 6, 1);
                            sprite.position.set(0, 6, -45); // float above arena
                            sprite.userData.hp = 400;
                            this.scene.add(sprite);

                            // boss object with update that throws fireballs toward player
                            const boss = {
                                name: 'The Mouthy',
                                alive: true,
                                mesh: sprite,
                                fireCooldown: 1.6, // seconds between volleys
                                fireTimer: 0.6,
                                // spawn a volley of 3 fireballs toward player
                                spawnFireball: (targetPos) => {
                                    for (let i = 0; i < 3; i++) {
                                        const fMat = new THREE.MeshStandardMaterial({ color: 0xff6633, emissive: 0xff2200, emissiveIntensity: 1.2 });
                                        const fGeo = new THREE.SphereGeometry(0.28, 8, 8);
                                        const ball = new THREE.Mesh(fGeo, fMat);
                                        // start near boss mouth with slight random offset
                                        const start = boss.mesh.position.clone().add(new THREE.Vector3((Math.random()-0.5)*1.2, -0.6, (Math.random()-0.5)*1.2));
                                        ball.position.copy(start);
                                        // metadata for clearer handling & lifetime
                                        ball.userData.speed = 10 + Math.random() * 3;
                                        // compute normalized direction toward player's current position
                                        const dir = new THREE.Vector3().subVectors(targetPos.clone().add(new THREE.Vector3(0,0.9,0)), start).normalize();
                                        ball.userData.dir = dir;
                                        ball.userData.isFire = true;
                                        ball.userData.owner = 'mouthy';
                                        ball.userData.spawnTime = Date.now();
                                        ball.userData.maxLifeMs = 20000; // safety lifetime (20s)
                                        this.scene.add(ball);
                                        // integrate as a simple projectile in enemies array so update loop handles it
                                        const proj = {
                                            alive: true,
                                            mesh: ball,
                                            update: (tp, dt) => {
                                                if (!proj.alive) return;
                                                // move projectile
                                                proj.mesh.position.add(proj.mesh.userData.dir.clone().multiplyScalar(proj.mesh.userData.speed * dt));
                                                // lifetime check - remove after maxLifeMs
                                                try {
                                                    if (Date.now() - (proj.mesh.userData.spawnTime || 0) > (proj.mesh.userData.maxLifeMs || 20000)) {
                                                        proj.alive = false;
                                                        try { this.scene.remove(proj.mesh); } catch(e){}
                                                        return;
                                                    }
                                                } catch(e){}

                                                // simple lifetime / out-of-bounds removal
                                                if (proj.mesh.position.distanceTo(boss.mesh.position) > 160 || proj.mesh.position.y < -10) {
                                                    proj.alive = false;
                                                    try { this.scene.remove(proj.mesh); } catch(e){}
                                                }
                                                // collision with player: kill player instantly
                                                try {
                                                    const pd = proj.mesh.position.distanceTo(this.player.mesh.position);
                                                    if (pd < 1.1) {
                                                        // instant kill
                                                        this.player.hp = 0;
                                                        this.gameState.gameOver = true;
                                                        const instr2 = document.getElementById('instructions');
                                                        if (instr2) instr2.innerHTML = "KILLED BY THE MOUTHY'S FIREBALL! Refresh to retry.";
                                                        // remove projectile
                                                        proj.alive = false;
                                                        try { this.scene.remove(proj.mesh); } catch(e){}
                                                    }
                                                } catch (e) {}
                                            },
                                            destroy: () => {
                                                proj.alive = false;
                                                try { this.scene.remove(proj.mesh); } catch(e){}
                                            }
                                        };
                                        this.enemies.push(proj);
                                    }
                                },
                                update: (tp, dt) => {
                                    if (!boss.alive) return;
                                    // small bobbing
                                    boss.mesh.position.y = 5.8 + Math.sin(Date.now() * 0.0015) * 0.4;
                                    // face toward player
                                    try {
                                        const dir = new THREE.Vector3().subVectors(this.player.mesh.position, boss.mesh.position);
                                        dir.y = 0;
                                        if (dir.length() > 0.01) {
                                            const yaw = Math.atan2(dir.x, dir.z);
                                            boss.mesh.rotation.y = yaw;
                                        }
                                    } catch(e){}
                                    boss.fireTimer -= dt;
                                    if (boss.fireTimer <= 0) {
                                        boss.fireTimer = boss.fireCooldown + Math.random() * 0.6;
                                        boss.spawnFireball(this.player.mesh.position.clone());
                                        // play a fire sound if available
                                        if (this.alertsEnabled) this.playSound('bomb');
                                    }
                                    // if player is dead, boss may taunt (no-op)
                                },
                                destroy: () => {
                                    boss.alive = false;
                                    try { this.scene.remove(boss.mesh); } catch(e){}
                                }
                            };
                            this._mouthyBoss = boss;
                            this.enemies.push(boss);
                            if (this._announcementText) {
                                this._announcementText.textContent = "THE MOUTHY HAS AWOKEN!";
                                setTimeout(() => { this._announcementText.textContent = 'UPDATES MORE SOON!'; }, 2200);
                            }
                        } catch (err) {
                            console.warn('Failed to spawn The Mouthy boss', err);
                        }
                    } else {
                        // reposition existing boss to arena
                        try {
                            this._mouthyBoss.mesh.position.set(0, 6, -45);
                            this._mouthyBoss.alive = true;
                        } catch(e){}
                    }

                    // Play ominous chime
                    if (this.alertsEnabled) this.playSound('day');

                } catch (err) {
                    console.warn('Cursed teleport failed', err);
                }
                return;
            }

            // SURVIVAL TOWN: SPIDER map — a challenged zone where spider throwers hunt the player
            if (d === 'survival-spider' || d === 'survival town spider') {
                try {
                    // Move player to survival town coordinates
                    this.player.mesh.position.set(12, 0, 8);
                    if (this.world) this.world.playerPosition = this.player.mesh.position;

                    // Visuals: dusky, slightly green-tinted for spider town
                    try {
                        this.scene.background = new THREE.Color(0x2b3028);
                        this.scene.fog = new THREE.FogExp2(0x2b3028, 0.045);
                    } catch (err) { console.warn(err); }

                    // Instructions UI
                    const instr = document.getElementById('instructions');
                    if (instr) {
                        instr.innerHTML = "SURVIVAL TOWN: SPIDER — Survive waves of Thrower Spiders! Avoid projectiles and stay mobile.";
                        instr.style.background = "rgba(40,10,20,0.85)";
                    }

                    // Spawn a small spider army of throwers that lob projectiles at the player
                    const loader = new THREE.TextureLoader();
                    for (let i = 0; i < 12; i++) {
                        const angle = Math.random() * Math.PI * 2;
                        const r = 8 + Math.random() * 14;
                        const spawnPos = new THREE.Vector3(this.player.mesh.position.x + Math.cos(angle) * r, 0, this.player.mesh.position.z + Math.sin(angle) * r);

                        // create sprite from Thrower_Purple_spider.webp if available
                        let sprite = null;
                        try {
                            const tex = loader.load('/Thrower_Purple_spider.webp');
                            const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
                            sprite = new THREE.Sprite(mat);
                            sprite.scale.set(1.8 + Math.random() * 1.2, 1.8 + Math.random() * 1.2, 1);
                            sprite.position.copy(spawnPos);
                            sprite.position.y = 1.2;
                            this.scene.add(sprite);
                        } catch (e) {
                            // fallback to simple red sprite
                            const mat = new THREE.SpriteMaterial({ color: 0x993366 });
                            sprite = new THREE.Sprite(mat);
                            sprite.scale.set(1.6, 1.6, 1);
                            sprite.position.copy(spawnPos);
                            sprite.position.y = 1.2;
                            this.scene.add(sprite);
                        }

                        // lightweight spider enemy object with throwing behavior
                        const spider = {
                            alive: true,
                            mesh: sprite,
                            speed: 1.6 + Math.random() * 0.8,
                            throwTimer: 1.0 + Math.random() * 1.6,
                            update: (targetPos, dt) => {
                                if (!spider.alive) return;
                                try {
                                    // seek the player slowly
                                    const dir = new THREE.Vector3().subVectors(targetPos, spider.mesh.position);
                                    dir.y = 0;
                                    const dist = dir.length();
                                    if (dist > 6) {
                                        dir.normalize();
                                        spider.mesh.position.add(dir.multiplyScalar(spider.speed * dt));
                                    } else {
                                        // idle bob/face
                                        spider.mesh.position.y = 1.2 + Math.sin(Date.now() * 0.002 + Math.random()) * 0.12;
                                    }

                                    // throwing projectile logic
                                    spider.throwTimer -= dt;
                                    if (spider.throwTimer <= 0) {
                                        spider.throwTimer = 1.0 + Math.random() * 1.6;
                                        // spawn a small projectile aimed at the player
                                        const ballMat = new THREE.MeshStandardMaterial({ color: 0x9b59ff, emissive: 0x7d3cff });
                                        const ballGeo = new THREE.SphereGeometry(0.18, 8, 8);
                                        const ball = new THREE.Mesh(ballGeo, ballMat);
                                        const start = spider.mesh.position.clone().add(new THREE.Vector3((Math.random()-0.5)*0.5, -0.4, (Math.random()-0.5)*0.5));
                                        ball.position.copy(start);
                                        ball.userData.dir = new THREE.Vector3().subVectors(targetPos.clone().add(new THREE.Vector3(0,0.9,0)), start).normalize();
                                        ball.userData.speed = 8 + Math.random() * 3;
                                        ball.userData.spawnTime = Date.now();
                                        ball.userData.maxLifeMs = 12000;
                                        this.scene.add(ball);

                                        const proj = {
                                            alive: true,
                                            mesh: ball,
                                            update: (tp, dtdt) => {
                                                if (!proj.alive) return;
                                                proj.mesh.position.add(proj.mesh.userData.dir.clone().multiplyScalar(proj.mesh.userData.speed * dtdt));
                                                // lifetime
                                                if (Date.now() - (proj.mesh.userData.spawnTime || 0) > (proj.mesh.userData.maxLifeMs || 12000)) {
                                                    proj.alive = false;
                                                    try { this.scene.remove(proj.mesh); } catch(e){}
                                                    return;
                                                }
                                                // collision with player
                                                try {
                                                    if (proj.mesh.position.distanceTo(this.player.mesh.position) < 1.0) {
                                                        this.player.hp = (this.player.hp === undefined) ? 100 : this.player.hp;
                                                        this.player.hp -= 14; // moderate damage
                                                        proj.alive = false;
                                                        try { this.scene.remove(proj.mesh); } catch(e){}
                                                        if (this.player.hp <= 0) {
                                                            this.gameState.gameOver = true;
                                                            const instr2 = document.getElementById('instructions');
                                                            if (instr2) instr2.innerHTML = "GAME OVER — Killed by spiders! Refresh to retry.";
                                                        }
                                                    }
                                                } catch (e) {}
                                            },
                                            destroy: () => { proj.alive = false; try { this.scene.remove(proj.mesh); } catch(e){} }
                                        };
                                        this.enemies.push(proj);
                                    }
                                } catch (e) {}
                            },
                            destroy: () => {
                                spider.alive = false;
                                try { this.scene.remove(spider.mesh); } catch (e) {}
                            }
                        };

                        this.enemies.push(spider);
                    }

                    // set survival flags and play alert
                    this.gameState.isSurvival = true;
                    this.enemySpawnThreshold = 0.8;
                    if (this.alertsEnabled) this.playSound('day');

                } catch (err) {
                    console.warn('Survival-spider teleport failed', err);
                }
                return;
            }

            // IShowMaps — first-person IShowEyes encounter (dark, image.png background, pointer-lock + WASD)
            if (d === 'ishowmaps' || d === 'ishow-maps') {
                try {
                    // Mark IShow theme active (used by bad-ending logic)
                    this.gameState.ishowTheme = true;
                    this.gameState.isSurvival = true;

                    // Use image.png as scene background texture
                    try {
                        const loader = new THREE.TextureLoader();
                        const tex = loader.load('/image.png');
                        this.scene.background = tex;
                        // reduce fog to emphasize looming sprite
                        this.scene.fog = new THREE.FogExp2(0x000000, 0.12);
                    } catch (e) {
                        // fallback to dark sky
                        this.scene.background = new THREE.Color(0x000000);
                        this.scene.fog = new THREE.FogExp2(0x000000, 0.12);
                    }

                    // Move player to IShowMaps arena and hide third-person mesh
                    try {
                        const eyePos = new THREE.Vector3(0, 1.2, -6);
                        this.player.mesh.position.copy(eyePos);
                        if (this.world) this.world.playerPosition = this.player.mesh.position;
                        // hide the 3rd-person mesh so first-person view is unobstructed
                        try { this.player.mesh.visible = false; } catch(e){}
                    } catch (e) {}

                    // Enter first-person mode: enable pointer lock & WASD controls
                    try {
                        if (typeof this.enableFirstPersonMode === 'function') {
                            this.enableFirstPersonMode();
                        } else {
                            // simple fallback settings
                            this.firstPerson = true;
                            this.fpYaw = 0;
                            this.fpPitch = 0;
                            this.fpKeys = { forward:false, back:false, left:false, right:false };
                        }
                    } catch (e) { console.warn('Failed to enable first-person controls', e); }

                    // Spawning the unstoppable/faster IShowEyes boss (use existing helper if available)
                    try {
                        // ensure the boss is present and more aggressive: spawn then bump movement timers
                        if (typeof this.spawnIshoweyesBoss === 'function') {
                            this.spawnIshoweyesBoss();
                        } else {
                            // fallback: create a large sprite that moves quickly toward the player
                            const tex = new THREE.TextureLoader().load('/ishoweyes.jpeg');
                            const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
                            const sprite = new THREE.Sprite(mat);
                            sprite.scale.set(9,9,1);
                            sprite.position.copy(this.player.mesh.position).add(new THREE.Vector3(0,6,-10));
                            this.scene.add(sprite);
                            const rapid = {
                                alive:true,
                                mesh:sprite,
                                update:(tp, dt) => {
                                    if (!rapid.alive) return;
                                    try {
                                        const dir = new THREE.Vector3().subVectors(this.player.mesh.position, rapid.mesh.position);
                                        dir.y = 0;
                                        if (dir.length() > 0.05) {
                                            dir.normalize();
                                            rapid.mesh.position.add(dir.multiplyScalar(6.5 * dt)); // faster than player (~5)
                                        }
                                    } catch(e){}
                                },
                                destroy:()=>{ rapid.alive=false; try{ this.scene.remove(rapid.mesh);}catch(e){} }
                            };
                            this.enemies.push(rapid);
                        }

                        // Immediately make IShowEyes faster than player in any existing boss object
                        try {
                            if (this._ishBoss && this._ishBoss.alive) {
                                // make boss behavior tick faster by reducing strike interval and ensuring movement toward player
                                this._ishBoss.strikeInterval = Math.max(0.6, (this._ishBoss.strikeInterval || 1.4) * 0.4);
                                // provide a small movement helper if not present: push closer each frame
                                if (typeof this._ishBoss.update === 'function') {
                                    const originalUpdate = this._ishBoss.update.bind(this._ishBoss);
                                    this._ishBoss.update = (tp, dt) => {
                                        originalUpdate(tp, dt);
                                        try {
                                            // nudge boss toward player faster
                                            const m = this._ishBoss.mesh;
                                            if (m && m.position && this.player && this.player.mesh) {
                                                const dir = new THREE.Vector3().subVectors(this.player.mesh.position, m.position);
                                                dir.y = 0;
                                                if (dir.length() > 0.05) {
                                                    dir.normalize();
                                                    m.position.add(dir.multiplyScalar(5.2 * dt));
                                                }
                                            }
                                        } catch(e){}
                                    };
                                }
                            }
                        } catch (e) {}
                    } catch (e) { console.warn('spawnIshoweyesBoss failed for IShowMaps', e); }

                    // Update UI & instructions
                    const instr = document.getElementById('instructions');
                    if (instr) {
                        instr.innerHTML = "IShowMaps — FIRST PERSON: WASD / Arrow keys to move, mouse to look. Avoid IShowEyes or be jump-scared.";
                        instr.style.background = "rgba(0,0,0,0.8)";
                    }

                    // Play subtle day-change chime
                    if (this.alertsEnabled) this.playSound('day');

                    return;
                } catch (e) {
                    console.warn('IShowMaps teleport failed', e);
                }
            }

            // ESCAPE: NATURAL DIEASTER — new map: environmental hazards + timed escape objective

            // NEW: 2003 MAP — "Doodle Apple" consuming boss experience
            if (d === '2003-map' || d === '2003 map') {
                try {
                    // Teleport player to a special 2003 arena
                    this.player.mesh.position.set(0, 0, -320);
                    if (this.world) this.world.playerPosition = this.player.mesh.position;

                    // Dark / sketchy visuals to match doodle aesthetic
                    try {
                        this.scene.background = new THREE.Color(0x1b1b1b);
                        this.scene.fog = new THREE.FogExp2(0x1b1b1b, 0.12);
                    } catch (err) { console.warn(err); }

                    // Instructions UI
                    const instr = document.getElementById('instructions');
                    if (instr) {
                        instr.innerHTML = "2003 MAP — You encountered the Doodle Apple. Hold Shift to run (but you cannot escape).";
                        instr.style.background = "rgba(0,0,0,0.85)";
                    }

                    // Spawn the Doodle Apple boss (sprite based on doodle asset)
                    try {
                        const tex = new THREE.TextureLoader().load('/DoodleApple2003.png');
                        const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
                        const sprite = new THREE.Sprite(mat);
                        sprite.scale.set(8, 8, 1);
                        sprite.position.copy(this.player.mesh.position).add(new THREE.Vector3(0, 6, -8));
                        sprite.name = 'DoodleApple';
                        sprite.userData.hp = 9999;
                        this.scene.add(sprite);

                        // Boss object that will "consume" the player shortly after arrival
                        const doodle = {
                            name: 'DoodleApple',
                            alive: true,
                            mesh: sprite,
                            consumeTimer: 2.2, // seconds until consume (short delay so player sees it)
                            update: (tp, dt) => {
                                if (!doodle.alive) return;
                                // bob and stare
                                doodle.mesh.position.y = 5.8 + Math.sin(Date.now() * 0.0012) * 0.42;
                                // slowly drift toward player
                                try {
                                    const dir = new THREE.Vector3().subVectors(this.player.mesh.position, doodle.mesh.position);
                                    dir.y = 0;
                                    if (dir.length() > 4.2) {
                                        dir.normalize();
                                        doodle.mesh.position.add(dir.multiplyScalar(0.6 * dt));
                                    }
                                } catch (e) {}
                                doodle.consumeTimer -= dt;
                                if (doodle.consumeTimer <= 0) {
                                    // Consume: remove player visuals, set bad ending UI and speak voiceline
                                    try {
                                        // mark game over / consumed
                                        this.gameState.gameOver = true;
                                        // visual overlay for consumption
                                        let overlay = document.getElementById('doodle-consume-overlay');
                                        if (!overlay) {
                                            overlay = document.createElement('div');
                                            overlay.id = 'doodle-consume-overlay';
                                            overlay.style.position = 'fixed';
                                            overlay.style.inset = '0';
                                            overlay.style.zIndex = '200000';
                                            overlay.style.background = '#000';
                                            overlay.style.color = '#fff';
                                            overlay.style.display = 'flex';
                                            overlay.style.alignItems = 'center';
                                            overlay.style.justifyContent = 'center';
                                            overlay.style.fontFamily = 'Segoe UI, Tahoma, sans-serif';
                                            overlay.style.fontSize = '20px';
                                            overlay.style.textAlign = 'center';
                                            overlay.innerHTML = '<div><strong>You got consumed by Doodle Apple</strong><div style="font-size:14px;margin-top:8px;">It laughs at your futile escape attempts...</div></div>';
                                            document.body.appendChild(overlay);
                                        } else {
                                            overlay.style.display = 'flex';
                                        }

                                        // play short TTS voiceline "hahaha"
                                        try {
                                            const utter = new SpeechSynthesisUtterance('hahaha');
                                            utter.rate = 0.9;
                                            speechSynthesis.cancel();
                                            speechSynthesis.speak(utter);
                                        } catch (e) {
                                            console.warn('SpeechSynthesis failed for doodle haha', e);
                                        }

                                        // remove player mesh (hide) and freeze movement by pausing game loop via paused flag
                                        try {
                                            if (this.player && this.player.mesh) this.player.mesh.visible = false;
                                        } catch (e) {}
                                        this.paused = true;

                                        // doodle persists; mark doodle active so Shift-run handler can reference it
                                        this._doodleActive = true;

                                        // add Shift-run listener to speak second line when player attempts to run
                                        if (!this._doodleShiftHandlerAdded) {
                                            this._doodleShiftHandlerAdded = true;
                                            const shiftHandler = (ev) => {
                                                try {
                                                    if (!this._doodleActive) return;
                                                    if (ev.key === 'Shift' || ev.key === 'ShiftLeft' || ev.key === 'ShiftRight') {
                                                        // Speak "You cannot escape if you run"
                                                        try {
                                                            const u2 = new SpeechSynthesisUtterance('You cannot escape if you run');
                                                            u2.rate = 0.95;
                                                            speechSynthesis.cancel();
                                                            speechSynthesis.speak(u2);
                                                        } catch (e) {}
                                                    }
                                                } catch (e) {}
                                            };
                                            window.addEventListener('keydown', shiftHandler);
                                            // store so we can remove later if needed
                                            this._doodleShiftHandler = shiftHandler;
                                        }
                                    } catch (e) { console.warn('Doodle consume sequence failed', e); }
                                    // ensure we only execute consume once
                                    doodle.alive = false;
                                }
                            },
                            destroy: () => {
                                doodle.alive = false;
                                try { this.scene.remove(doodle.mesh); } catch (e) {}
                                // cleanup overlay and shift handler
                                try { const ov = document.getElementById('doodle-consume-overlay'); if (ov) ov.remove(); } catch(e){}
                                try { if (this._doodleShiftHandler) { window.removeEventListener('keydown', this._doodleShiftHandler); this._doodleShiftHandler = null; this._doodleShiftHandlerAdded = false; } } catch(e){}
                                this._doodleActive = false;
                            }
                        };

                        // register boss into enemies array so it's updated each frame
                        this.enemies.push(doodle);
                        if (this._announcementText) {
                            this._announcementText.textContent = 'A Doodle Apple appears... it seems hungry.';
                            setTimeout(()=>{ try{ this._announcementText.textContent='UPDATES MORE SOON!'; }catch(e){} }, 2400);
                        }
                    } catch (err) {
                        console.warn('Failed to spawn Doodle Apple boss', err);
                    }

                    // play a subtle ominous chime
                    if (this.alertsEnabled) this.playSound('day');

                } catch (err) {
                    console.warn('2003-map teleport failed', err);
                }
                return;
            }
            if (d === 'escape-natural-dieaster' || d === 'escape the natural dieaster') {
                try {
                    // Teleport player to disaster arena
                    this.player.mesh.position.set(0, 0, -200);
                    if (this.world) this.world.playerPosition = this.player.mesh.position;

                    // Visuals: stormy sky, smoky fog and debris plane
                    try {
                        this.scene.background = new THREE.Color(0x3b3b3b); // storm gray
                        this.scene.fog = new THREE.FogExp2(0x2e2e2e, 0.08);
                    } catch (err) { console.warn(err); }

                    // Create a debris plane overlay if missing
                    if (!this._dieasterDebris) {
                        const debrisMat = new THREE.MeshStandardMaterial({ color: 0x666565, transparent: true, opacity: 0.28 });
                        const debris = new THREE.Mesh(new THREE.PlaneGeometry(140, 140), debrisMat);
                        debris.rotation.x = -Math.PI / 2;
                        debris.position.y = 0.12;
                        this._dieasterDebris = debris;
                        this.scene.add(this._dieasterDebris);
                    } else {
                        this._dieasterDebris.position.set(0, 0.12, -200);
                    }

                    // Instructions UI
                    const instr = document.getElementById('instructions');
                    if (instr) {
                        instr.innerHTML = "ESCAPE: NATURAL DIEASTER — Survive the hazards and reach the safe zone in 45s. Hold mouse/touch to move.";
                        instr.style.background = "rgba(80,10,10,0.85)";
                    }

                    // Gameplay: set a 45s escape timer and spawn initial hazards (falling debris + small enemies)
                    this.gameState.escapeDieaster = {
                        active: true,
                        timer: 45,
                        safeZone: new THREE.Vector3(0, 0, -240)
                    };

                    // Place a visible safe-zone marker (a glowing sprite)
                    try {
                        if (!this._dieasterSafeZone) {
                            const tex = new THREE.TextureLoader().load('/warning-sign-icon-transparent-background-free-png.webp');
                            const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
                            spr.scale.set(4, 4, 1);
                            spr.position.copy(this.gameState.escapeDieaster.safeZone);
                            spr.position.y = 1.2;
                            spr.userData.isSafeZone = true;
                            this.scene.add(spr);
                            this._dieasterSafeZone = spr;
                        } else {
                            this._dieasterSafeZone.position.copy(this.gameState.escapeDieaster.safeZone);
                        }
                    } catch (e) {}

                    // Spawn an initial set of hazards: falling debris projectiles and a few enemies
                    for (let i = 0; i < 10; i++) {
                        const angle = Math.random() * Math.PI * 2;
                        const r = 8 + Math.random() * 40;
                        const spawnX = this.player.mesh.position.x + Math.cos(angle) * r;
                        const spawnZ = this.player.mesh.position.z + Math.sin(angle) * r;
                        // falling debris: create a lightweight projectile that falls toward ground then disappears
                        const ballMat = new THREE.MeshStandardMaterial({ color: 0x8B6F4E, emissive: 0x442200 });
                        const ballGeo = new THREE.SphereGeometry(0.26 + Math.random() * 0.3, 8, 8);
                        const debris = new THREE.Mesh(ballGeo, ballMat);
                        debris.position.set(spawnX, 12 + Math.random() * 6, spawnZ);
                        debris.userData.falling = true;
                        debris.userData.speed = 9 + Math.random() * 6;
                        this.scene.add(debris);
                        const proj = {
                            alive: true,
                            mesh: debris,
                            update: (tp, dtdt) => {
                                if (!proj.alive) return;
                                proj.mesh.position.y -= proj.mesh.userData.speed * dtdt;
                                // small horizontal drift toward center
                                const drift = new THREE.Vector3().subVectors(new THREE.Vector3(0,0, -200), proj.mesh.position);
                                drift.y = 0;
                                if (drift.length() > 0.1) drift.normalize().multiplyScalar(0.25 * dtdt);
                                proj.mesh.position.add(drift);
                                if (proj.mesh.position.y <= 0.9) {
                                    // impact effect and remove; damage player if nearby
                                    try {
                                        if (proj.mesh.position.distanceTo(this.player.mesh.position) < 1.2) {
                                            this.player.hp = (this.player.hp === undefined) ? 100 : this.player.hp;
                                            this.player.hp -= 18;
                                            if (this.player.hp <= 0) {
                                                this.gameState.gameOver = true;
                                                document.getElementById('instructions').innerHTML = "KILLED BY DEBRIS! Refresh to retry.";
                                            }
                                        }
                                    } catch (e) {}
                                    proj.alive = false;
                                    try { this.scene.remove(proj.mesh); } catch(e){}
                                }
                            },
                            destroy: () => { proj.alive = false; try { this.scene.remove(proj.mesh); } catch(e){} }
                        };
                        this.enemies.push(proj);
                    }

                    // Also spawn a few standard enemies that roam the area
                    for (let i = 0; i < 6; i++) {
                        const angle = Math.random() * Math.PI * 2;
                        const r = 10 + Math.random() * 30;
                        const spawnPos = new THREE.Vector3(this.player.mesh.position.x + Math.cos(angle) * r, 0, this.player.mesh.position.z + Math.sin(angle) * r);
                        const en = new Enemy(this.scene, spawnPos);
                        en.speed = 1.8 + Math.random() * 1.2;
                        this.enemies.push(en);
                    }

                    // Play a subtle alarm chime
                    if (this.alertsEnabled) this.playSound('day');

                    // Ensure updateGameState checks escape timer; reuse existing update loop: add minimal handler here
                    // (updateGameState already runs; we add a simple check so that when timer expires we punish failure)
                    // The main update loop will decrement gameState.escapeDieaster.timer if active in updateGameState logic.

                } catch (err) {
                    console.warn('Escape Natural Dieaster teleport failed', err);
                }
                return;
            }



            // WORLD BLACKOUT — new map: plunges the world into dark blackout, limited vision and blackout overlay
            if (d === 'world-blackout' || d === 'blackout' || d === 'world blackout') {
                try {
                    // Teleport player to blackout arena
                    this.player.mesh.position.set(0, 0, 0);
                    if (this.world) this.world.playerPosition = this.player.mesh.position;

                    // Enter blackout state: near-complete darkness, dense fog and restricted visuals
                    try {
                        this.scene.background = new THREE.Color(0x000000);
                        this.scene.fog = new THREE.FogExp2(0x000000, 0.12);
                        // tint ambient light down
                        this.scene.children.forEach(c => {
                            try { if (c.type === 'AmbientLight') c.intensity = 0.22; } catch(e){}
                            try { if (c.type === 'DirectionalLight') c.intensity = 0.4; } catch(e){}
                        });
                    } catch (err) { console.warn('blackout visuals failed', err); }

                    // Add a soft screen overlay to emphasize blackout (DOM)
                    try {
                        let overlay = document.getElementById('world-blackout-overlay');
                        if (!overlay) {
                            overlay = document.createElement('div');
                            overlay.id = 'world-blackout-overlay';
                            overlay.style.position = 'fixed';
                            overlay.style.inset = '0';
                            overlay.style.zIndex = '200010';
                            overlay.style.background = 'radial-gradient(circle at 50% 40%, rgba(0,0,0,0) 0%, rgba(0,0,0,0.6) 30%, rgba(0,0,0,0.95) 70%)';
                            overlay.style.pointerEvents = 'none';
                            overlay.style.transition = 'opacity 0.6s ease';
                            document.body.appendChild(overlay);
                        } else {
                            overlay.style.display = 'block';
                        }
                        // small notice HUD
                        const noteId = 'world-blackout-note';
                        let note = document.getElementById(noteId);
                        if (!note) {
                            note = document.createElement('div');
                            note.id = noteId;
                            note.style.position = 'fixed';
                            note.style.left = '50%';
                            note.style.top = '12%';
                            note.style.transform = 'translateX(-50%)';
                            note.style.zIndex = '200011';
                            note.style.background = 'rgba(0,0,0,0.75)';
                            note.style.color = '#FFD54F';
                            note.style.padding = '10px 12px';
                            note.style.borderRadius = '10px';
                            note.style.fontFamily = 'Segoe UI, Tahoma, sans-serif';
                            note.style.fontSize = '13px';
                            note.innerHTML = '<strong>WORLD BLACKOUT</strong><div style="font-size:12px;color:#ccc;margin-top:6px;">Limited visibility — use light sources and stay near Builder G.</div>';
                            document.body.appendChild(note);
                            // auto-hide after 12s
                            setTimeout(() => { try { note.style.display = 'none'; } catch(e){} }, 12000);
                        } else {
                            note.style.display = 'block';
                            setTimeout(() => { try { note.style.display = 'none'; } catch(e){} }, 12000);
                        }
                    } catch (e) { console.warn('Failed to create blackout overlay', e); }

                    // Gameplay: limit player vision (simulate by reducing camera far plane and adding ambient darkness) and spawn a few stealth enemies
                    try {
                        this.camera.far = Math.max(30, this.camera.far);
                        this.camera.updateProjectionMatrix();
                        this.gameState.worldBlackout = true;
                        this.gameState.isSurvival = true;
                        // spawn stealthy enemies that appear briefly near player
                        const p = this.player.mesh.position.clone();
                        for (let i = 0; i < 8; i++) {
                            const angle = Math.random() * Math.PI * 2;
                            const r = 4 + Math.random() * 10;
                            const spawnPos = new THREE.Vector3(p.x + Math.cos(angle) * r, 0, p.z + Math.sin(angle) * r);
                            const en = new Enemy(this.scene, spawnPos);
                            en.speed = 2.8 + Math.random() * 1.6;
                            // give them a low-visibility material tint if sprite-based
                            try { if (en.mesh && en.mesh.material && en.mesh.material.color) en.mesh.material.color.lerp(new THREE.Color(0x111111), 0.6); } catch(e){}
                            this.enemies.push(en);
                        }
                    } catch (e) { console.warn('Blackout gameplay setup failed', e); }

                    // Play subtle alarm/ambience if alerts enabled
                    if (this.alertsEnabled) this.playSound('day');

                    // update instruction bar
                    const instr = document.getElementById('instructions');
                    if (instr) {
                        instr.innerHTML = "WORLD BLACKOUT — Visibility is poor. Use Builder G or light sources to survive.";
                        instr.style.background = "rgba(0,0,0,0.75)";
                    }
                } catch (err) {
                    console.warn('World Blackout teleport failed', err);
                }
                return;
            }

            // CAPYWORLD AMERCIA — capybara workers building houses
            if (d === 'capyworld-amercia' || d === 'capyworld' || d === 'capyworld-america') {
                try {
                    // Teleport player to CapyWorld center
                    this.player.mesh.position.set(6, 0, 2);
                    if (this.world) this.world.playerPosition = this.player.mesh.position;

                    // Visuals: sunny pasture and a slightly warmer green tint
                    try {
                        this.scene.background = new THREE.Color(0xCFEED8);
                        this.scene.fog = new THREE.FogExp2(0xCFEED8, 0.015);
                        if (this.world && this.world._vegetationItems) {
                            this.world._vegetationItems.forEach(it => {
                                try { if (it.material && it.material.color) it.material.color.lerp(new THREE.Color(0xD7F7D9), 0.18); } catch(e){}
                            });
                        }
                    } catch (err) { console.warn(err); }

                    // Instruction UI
                    const instr = document.getElementById('instructions');
                    if (instr) {
                        instr.innerHTML = "CAPYWORLD AMERCIA — Capybara workers are building houses here; assist or observe!";
                        instr.style.background = "rgba(0,0,0,0.45)";
                    }

                    // Spawn a small group of capybara worker sprites constructing a simple house scaffold
                    try {
                        const loader = new THREE.TextureLoader();
                        const workerTex = loader.load('/channels4_profile (6).jpg'); // reuse G icon as worker face
                        const plankMat = new THREE.MeshStandardMaterial({ color: 0x8B5A2B });
                        const workerPositions = [
                            new THREE.Vector3(8, 0.9, 0),
                            new THREE.Vector3(4.5, 0.9, 1.8),
                            new THREE.Vector3(6.5, 0.9, -1.6)
                        ];

                        // create a small scaffold house group
                        if (!this._capyworldHouseGroup) {
                            const house = new THREE.Group();
                            // foundation
                            const base = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.2, 2.6), new THREE.MeshStandardMaterial({ color: 0xE0C097 }));
                            base.position.y = 0.1;
                            house.add(base);
                            // posts
                            for (let p = 0; p < 4; p++) {
                                const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.4, 0.08), plankMat);
                                post.position.set((p < 2 ? -1 : 1), 0.7, (p % 2 ? -1 : 1));
                                house.add(post);
                            }
                            // roof frame (simple)
                            const roof = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.08, 2.6), new THREE.MeshStandardMaterial({ color: 0xB85A2B }));
                            roof.position.y = 1.1;
                            house.add(roof);
                            house.position.set(6, 0, 0);
                            this._capyworldHouseGroup = house;
                            this.scene.add(this._capyworldHouseGroup);
                        } else {
                            this._capyworldHouseGroup.position.set(6,0,0);
                        }

                        // spawn worker sprites if not present
                        this._capyWorkers = this._capyWorkers || [];
                        if (this._capyWorkers.length === 0) {
                            workerPositions.forEach((pos, idx) => {
                                try {
                                    const mat = new THREE.SpriteMaterial({ map: workerTex, transparent: true });
                                    const spr = new THREE.Sprite(mat);
                                    spr.scale.set(1.6, 1.6, 1);
                                    spr.position.copy(pos);
                                    spr.position.y = 0.9;
                                    spr.userData.workTimer = 2 + Math.random() * 3;
                                    spr.userData.workRate = 6 + Math.random() * 6;
                                    spr.userData.originalY = spr.position.y;
                                    this.scene.add(spr);
                                    this._capyWorkers.push(spr);
                                } catch (e) {}
                            });
                        } else {
                            // reposition existing workers near new house
                            this._capyWorkers.forEach((w, i) => {
                                try { w.position.copy(workerPositions[i % workerPositions.length]); w.position.y = 0.9; } catch(e){}
                            });
                        }

                        // simple worker animation loop: bob and occasionally "hammer" (visual bounce + spawn small plank)
                        if (!this._capyWorkerTicker) {
                            this._capyWorkerTicker = setInterval(() => {
                                try {
                                    this._capyWorkers.forEach((w) => {
                                        try {
                                            // bob
                                            w.position.y = w.userData.originalY + Math.abs(Math.sin(Date.now() * 0.01 + (Math.random()))) * 0.08;
                                            // small "work" action occasionally: spawn a tiny plank visual that floats then disappears
                                            w.userData.workTimer -= 1;
                                            if (w.userData.workTimer <= 0) {
                                                w.userData.workTimer = 2 + Math.random() * 5;
                                                const plank = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.02, 0.46), plankMat);
                                                plank.position.copy(w.position).add(new THREE.Vector3(0, 0.6, (Math.random() - 0.5) * 0.4));
                                                this.scene.add(plank);
                                                // animate plank float and remove
                                                setTimeout(() => { try { this.scene.remove(plank); } catch(e){} }, 900);
                                            }
                                        } catch (e) {}
                                    });
                                } catch (e) {}
                            }, 600);
                        }
                    } catch (e) {
                        console.warn('Failed to spawn CapyWorld workers/house', e);
                    }

                    // gentle ambient chime to indicate a peaceful building area
                    if (this.alertsEnabled) this.playSound('day');

                } catch (err) {
                    console.warn('CapyWorld Amercia teleport failed', err);
                }
                return;
            }

            // TIME MACHINE — experimental map with temporal anomalies: enemies, boss support, and Ishoweyes risk
            if (d === 'time-machine' || d === 'time machine') {
                try {
                    // teleport player to Time Machine arena
                    this.player.mesh.position.set(0, 0, -75);
                    if (this.world) this.world.playerPosition = this.player.mesh.position;

                    // Strange visuals: violet sky, flickering fog
                    try {
                        this.scene.background = new THREE.Color(0x1a0b2e);
                        this.scene.fog = new THREE.FogExp2(0x1a0b2e, 0.05);
                    } catch (err) { console.warn('Time Machine visuals failed', err); }

                    // Instruction UI
                    const instr = document.getElementById('instructions');
                    if (instr) {
                        instr.innerHTML = "TIME MACHINE — Temporal anomalies ahead! Expect mixed enemies, bosses, and a chance of Ishoweyes.";
                        instr.style.background = "rgba(40,0,60,0.8)";
                    }

                    // Spawn a mixed enemy wave around the player
                    const p = this.player.mesh.position.clone();
                    for (let i = 0; i < 14; i++) {
                        const angle = Math.random() * Math.PI * 2;
                        const r = 6 + Math.random() * 18;
                        const spawnPos = new THREE.Vector3(p.x + Math.cos(angle) * r, 0, p.z + Math.sin(angle) * r);
                        const en = new Enemy(this.scene, spawnPos);
                        // add slight temporal jitter to speed
                        en.speed = (en.speed || 2.5) * (0.9 + Math.random() * 0.8);
                        this.enemies.push(en);
                    }

                    // Spawn a couple of thrower spiders for projectile pressure
                    for (let i = 0; i < 6; i++) {
                        const angle = Math.random() * Math.PI * 2;
                        const r = 8 + Math.random() * 12;
                        const spawnPos = new THREE.Vector3(p.x + Math.cos(angle) * r, 0, p.z + Math.sin(angle) * r);
                        // create a simple spider-like enemy using Thrower_Purple_spider texture if available
                        try {
                            const tex = new THREE.TextureLoader().load('/Thrower_Purple_spider.webp');
                            const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
                            const sprite = new THREE.Sprite(mat);
                            sprite.scale.set(1.8, 1.8, 1);
                            sprite.position.copy(spawnPos);
                            sprite.position.y = 1.2;
                            this.scene.add(sprite);
                            const spiderLite = {
                                alive: true,
                                mesh: sprite,
                                speed: 1.6 + Math.random() * 0.8,
                                throwTimer: 1.0 + Math.random() * 1.6,
                                update: (targetPos, dt) => {
                                    if (!spiderLite.alive) return;
                                    try {
                                        const dir = new THREE.Vector3().subVectors(targetPos, spiderLite.mesh.position);
                                        dir.y = 0;
                                        if (dir.length() > 6) { dir.normalize(); spiderLite.mesh.position.add(dir.multiplyScalar(spiderLite.speed * dt)); }
                                        spiderLite.throwTimer -= dt;
                                        if (spiderLite.throwTimer <= 0) {
                                            spiderLite.throwTimer = 1.0 + Math.random() * 1.6;
                                            // spawn projectile aimed at player
                                            const ballMat = new THREE.MeshStandardMaterial({ color: 0x9b59ff, emissive: 0x7d3cff });
                                            const ballGeo = new THREE.SphereGeometry(0.18, 8, 8);
                                            const ball = new THREE.Mesh(ballGeo, ballMat);
                                            const start = spiderLite.mesh.position.clone();
                                            ball.position.copy(start);
                                            ball.userData.dir = new THREE.Vector3().subVectors(this.player.mesh.position.clone().add(new THREE.Vector3(0,0.9,0)), start).normalize();
                                            ball.userData.speed = 8 + Math.random() * 3;
                                            ball.userData.spawnTime = Date.now();
                                            this.scene.add(ball);
                                            const proj = {
                                                alive: true,
                                                mesh: ball,
                                                update: (tp, dtdt) => {
                                                    if (!proj.alive) return;
                                                    proj.mesh.position.add(proj.mesh.userData.dir.clone().multiplyScalar(proj.mesh.userData.speed * dtdt));
                                                    if (proj.mesh.position.distanceTo(this.player.mesh.position) < 1.0) {
                                                        this.player.hp = (this.player.hp === undefined) ? 100 : this.player.hp;
                                                        this.player.hp -= 12;
                                                        proj.alive = false;
                                                        try { this.scene.remove(proj.mesh); } catch (e) {}
                                                        if (this.player.hp <= 0) { this.gameState.gameOver = true; document.getElementById('instructions').innerHTML = 'GAME OVER — Killed in Time Machine.'; }
                                                    }
                                                },
                                                destroy: () => { proj.alive = false; try { this.scene.remove(proj.mesh); } catch(e){} }
                                            };
                                            this.enemies.push(proj);
                                        }
                                    } catch (e) {}
                                },
                                destroy: () => { spiderLite.alive = false; try { this.scene.remove(spiderLite.mesh); } catch(e){} }
                            };
                            this.enemies.push(spiderLite);
                        } catch (e) {
                            // fallback to standard enemy
                            this.enemies.push(new Enemy(this.scene, spawnPos));
                        }
                    }

                    // Chance to trigger a boss trio: James + Tan + Infector King as a temporal echo
                    setTimeout(() => {
                        try {
                            if (typeof this.spawnJamesBoss === 'function') this.spawnJamesBoss();
                            if (typeof this.spawnTanBoss === 'function') this.spawnTanBoss();
                            if (typeof this.spawnCastleInfectors === 'function') this.spawnCastleInfectors(20);
                            if (this.alertsEnabled) this.playSound('day');
                        } catch (e) { console.warn('Time Machine boss wave failed', e); }
                    }, 800);

                    // Small chance to spawn Ishoweyes (dangerous) — 30% chance
                    if (Math.random() < 0.3) {
                        setTimeout(() => {
                            try {
                                if (typeof this.spawnIshoweyesBoss === 'function') {
                                    this.spawnIshoweyesBoss();
                                    if (this._announcementText) {
                                        this._announcementText.textContent = 'Temporal anomaly: Ishoweyes has appeared!';
                                        setTimeout(()=>{ try{ this._announcementText.textContent='UPDATES MORE SOON!'; }catch(e){} }, 3000);
                                    }
                                }
                            } catch (e) { console.warn('Failed to spawn Ishoweyes in Time Machine', e); }
                        }, 1600);
                    }

                    // Play a short eerie time chime
                    if (this.alertsEnabled) {
                        try { this.playSound('day'); } catch(e){}
                    }
                } catch (err) {
                    console.warn('Time Machine teleport failed', err);
                }
                return;
            }

                // INSANE SERVER LOBBY — garden/house/disco lobby where players can buy "Become a Monster (IShowEyes)" or start Hide & Seek
                if (d === 'insane-lobby' || d === 'insane lobby') {
                    try {
                        // Position player in a decorated lobby area: garden + disco room
                        this.player.mesh.position.set(-2, 0, 2);
                        if (this.world) this.world.playerPosition = this.player.mesh.position;

                        // Create a low-overhead lobby scene: disco light plane + music control
                        try {
                            if (!this._insaneLobbyBackdrop) {
                                const disco = new THREE.Group();
                                // simple disco floor
                                const floorMat = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.6, roughness: 0.3 });
                                const floor = new THREE.Mesh(new THREE.CircleGeometry(6, 32), floorMat);
                                floor.rotation.x = -Math.PI / 2;
                                floor.position.set(0, 0.02, 2);
                                disco.add(floor);
                                // a rotating disco sprite using existing DancingBanana as visual (clone)
                                if (this.world && this.world.dancingBanana) {
                                    const clone = this.world.dancingBanana.clone();
                                    clone.scale.set(2.4, 2.4, 1);
                                    clone.position.set(0, 1.6, 2);
                                    disco.add(clone);
                                    this._insaneLobbyBanana = clone;
                                }
                                // small party lights: colored spheres
                                for (let i = 0; i < 6; i++) {
                                    const c = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(Math.random(), 0.8, 0.5), emissive: 0xffffff, emissiveIntensity: 0.6 }));
                                    c.position.set(Math.cos(i / 6 * Math.PI * 2) * 3.2, 2.2, 2 + Math.sin(i / 6 * Math.PI * 2) * 3.2);
                                    disco.add(c);
                                }
                                this._insaneLobbyBackdrop = disco;
                                this.scene.add(this._insaneLobbyBackdrop);
                            }
                        } catch (e) { console.warn('Failed to build insane lobby visuals', e); }

                        // Build a lightweight opinion/shop UI in DOM for the lobby
                        try {
                            let shop = document.getElementById('insane-shop');
                            if (!shop) {
                                shop = document.createElement('div');
                                shop.id = 'insane-shop';
                                shop.style.position = 'fixed';
                                shop.style.left = '18px';
                                shop.style.bottom = '18px';
                                shop.style.zIndex = '10005';
                                shop.style.background = 'rgba(0,0,0,0.75)';
                                shop.style.color = 'white';
                                shop.style.padding = '10px';
                                shop.style.borderRadius = '10px';
                                shop.style.fontFamily = 'Segoe UI, Tahoma, sans-serif';
                                shop.innerHTML = `
                                    <div style="font-weight:800;margin-bottom:6px;">Insane Lobby • Opinion Shop</div>
                                    <div style="font-size:13px;margin-bottom:8px;">Choose your role:</div>
                                    <div style="display:flex;gap:8px;margin-bottom:8px;">
                                        <button id="insane-role-survivor" style="flex:1;padding:8px;border-radius:8px;border:0;background:#4CAF50;color:white;">Survivor</button>
                                        <button id="insane-role-monster" style="flex:1;padding:8px;border-radius:8px;border:0;background:#d32f2f;color:white;">Become a Monster (IShowEyes) — Free</button>
                                    </div>
                                    <div style="font-size:13px;margin-bottom:8px;">Start Game:</div>
                                    <div style="display:flex;gap:8px;">
                                        <button id="insane-start-hide" style="flex:1;padding:8px;border-radius:8px;border:0;background:#1976D2;color:white;">Start Hide & Seek</button>
                                        <button id="insane-back" style="flex:1;padding:8px;border-radius:8px;border:0;background:#bdbdbd;color:#111;">Leave Lobby</button>
                                    </div>
                                    <div style="font-size:12px;color:#ddd;margin-top:8px;">Goal (Survivor): hide and collect 11 boxes; escape the Yellow Maze Backrooms when game starts.</div>
                                `;
                                document.body.appendChild(shop);

                                // Wire up buttons
                                document.getElementById('insane-role-survivor').onclick = () => {
                                    this.gameState.insaneRole = 'survivor';
                                    this._announcementText && (this._announcementText.textContent = 'Role set: Survivor — Hide & seek objective active.');
                                };
                                document.getElementById('insane-role-monster').onclick = () => {
                                    this.gameState.insaneRole = 'ishoweyes';
                                    this._announcementText && (this._announcementText.textContent = 'Role set: IShowEyes — you are now a monster.');
                                };
                                document.getElementById('insane-back').onclick = () => {
                                    try { shop.remove(); } catch(e){}
                                    try { if (this._insaneLobbyBackdrop) { this.scene.remove(this._insaneLobbyBackdrop); this._insaneLobbyBackdrop = null; } } catch(e){}
                                };
                                document.getElementById('insane-start-hide').onclick = () => {
                                    // Begin game: if survivor, teleport to backrooms maze; if ishoweyes, stay as hunter (spawn bosses optionally)
                                    const role = this.gameState.insaneRole || 'survivor';
                                    try { shop.remove(); } catch(e){}
                                    if (role === 'survivor') {
                                        // teleport survivors into backrooms yellow maze and start 59s timer
                                        window._teleportOverride = 'insane-backrooms';
                                        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'q' }));
                                    } else {
                                        // Monster mode: spawn Ishoweyes boss (if available) and position monster
                                        try {
                                            if (typeof this.spawnIshoweyesBoss === 'function') this.spawnIshoweyesBoss();
                                        } catch (e) {}
                                        try {
                                            this.player.mesh.position.set(-6, 0, -8);
                                            if (this.world) this.world.playerPosition = this.player.mesh.position;
                                        } catch (e) {}
                                    }
                                };
                            }
                        } catch (e) { console.warn('Failed to create insane lobby shop UI', e); }

                        // Play lobby music briefly (use jelly as placeholder boss music)
                        try { if (this.alertsEnabled) this.playSound('jelly'); } catch(e){}

                        if (this._announcementText) {
                            this._announcementText.textContent = 'Insane Lobby — pick your role and press Start Hide & Seek';
                            setTimeout(()=>{ try{ this._announcementText.textContent='UPDATES MORE SOON!'; }catch(e){} }, 2800);
                        }
                    } catch (e) {
                        console.warn('Failed to teleport to insane lobby', e);
                    }
                    return;
                }

                // INSANE BACKROOMS — Yellow path maze for survivors; 59s escape timer; monsters and bosses hunt survivors
                if (d === 'insane-backrooms' || d === 'backrooms' || d === 'insane backrooms') {
                    try {
                        // Setup yellow-tinted maze zone and place survivor at start
                        this.player.mesh.position.set(0, 0, -120);
                        if (this.world) this.world.playerPosition = this.player.mesh.position;

                        // Maze visuals: yellow tint and narrow corridors simulated by fog and backdrop
                        try {
                            this.scene.background = new THREE.Color(0xfff2a8);
                            this.scene.fog = new THREE.FogExp2(0xfff2a8, 0.02);
                        } catch (err) { console.warn(err); }

                        // Set timer for escape (59 seconds) and box collection objective
                        this.gameState.insaneEscapeTimer = 59;
                        this.gameState.insaneBoxesCollected = 0;
                        this.gameState.insaneBoxesNeeded = 11;
                        this.gameState.insaneActive = true;
                        this.gameState.isSurvival = true;

                        // Spawn scattered "boxes" (visual meshes) around the maze area for survivors to collect
                        try {
                            for (let i = 0; i < this.gameState.insaneBoxesNeeded; i++) {
                                const bx = new THREE.Mesh(new THREE.BoxGeometry(0.6,0.6,0.6), new THREE.MeshStandardMaterial({ color: 0xffd54f }));
                                const angle = Math.random() * Math.PI * 2;
                                const r = 6 + Math.random() * 28;
                                bx.position.set(this.player.mesh.position.x + Math.cos(angle) * r, 0.3, this.player.mesh.position.z + Math.sin(angle) * r);
                                bx.name = `insaneBox_${i}`;
                                bx.userData.isInsaneBox = true;
                                this.scene.add(bx);
                                // track boxes in a dedicated array for easy collection checks
                                this._insaneBoxes = this._insaneBoxes || [];
                                this._insaneBoxes.push(bx);
                            }
                        } catch (e) { console.warn('Failed to spawn insane boxes', e); }

                        // Spawn IShoweyes and additional bosses for hunt pressure (monsters)
                        try {
                            if (typeof this.spawnIshoweyesBoss === 'function') this.spawnIshoweyesBoss();
                            if (typeof this.spawnCastleInfectors === 'function') this.spawnCastleInfectors(12);
                        } catch (e) {}

                        // Play chase music for survivors
                        try { if (this.alertsEnabled) this.playSound('jelly'); } catch(e){}

                        // Instructions HUD update
                        const instr = document.getElementById('instructions');
                        if (instr) {
                            instr.innerHTML = `BACKROOMS MAZE — Survivor: collect ${this.gameState.insaneBoxesNeeded} boxes and escape in 59s!`;
                            instr.style.background = "rgba(0,0,0,0.65)";
                        }

                        // ensure updateGameState will handle countdown and box pickup checks
                    } catch (err) {
                        console.warn('Failed to teleport to insane backrooms', err);
                    }
                    return;
                }

            // NIGHTS / CAMPFIRE MAP — Survive the nights by protecting the campfire and killing all enemies
            if (d === 'nights' || d === 'survive the nights' || d === 'campfire') {
                try {
                    // Move player to camp area
                    this.player.mesh.position.set(10, 0, -10);
                    if (this.world) this.world.playerPosition = this.player.mesh.position;

                    // Night visuals: dark sky and subtle blue fog
                    try {
                        this.scene.background = new THREE.Color(0x050417);
                        this.scene.fog = new THREE.FogExp2(0x050417, 0.03);
                    } catch (err) { console.warn(err); }

                    // Create a campfire (glowing emissive sphere + light) if not present
                    if (!this._campfireGroup) {
                        const camp = new THREE.Group();
                        const fireMat = new THREE.MeshStandardMaterial({ color: 0xff8b3d, emissive: 0xff5a00, emissiveIntensity: 1.2 });
                        const flame = new THREE.Mesh(new THREE.SphereGeometry(0.6, 12, 10), fireMat);
                        flame.position.y = 0.6;
                        camp.add(flame);

                        const woodMat = new THREE.MeshStandardMaterial({ color: 0x5b3820 });
                        const wood = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.6), woodMat);
                        wood.rotation.z = Math.PI / 4;
                        wood.position.set(0.6, 0.1, 0);
                        camp.add(wood);
                        const wood2 = wood.clone();
                        wood2.rotation.z = -Math.PI / 4;
                        wood2.position.set(-0.6, 0.1, 0);
                        camp.add(wood2);

                        // Add gentle point light to simulate fire
                        const light = new THREE.PointLight(0xffaa66, 1.6, 10);
                        light.position.set(0, 1.2, 0);
                        camp.add(light);

                        camp.position.set(12, 0, -10);
                        this._campfireGroup = camp;
                        this.scene.add(this._campfireGroup);
                    } else {
                        // reposition if necessary
                        this._campfireGroup.position.set(12, 0, -10);
                    }

                    // Instructions and HUD
                    const instr = document.getElementById('instructions');
                    if (instr) {
                        instr.innerHTML = "NIGHTS — Survive each night by defending the campfire! Kill all enemies each wave.";
                        instr.style.background = "rgba(0,0,0,0.85)";
                    }

                    // Initialize nights mode state
                    this.gameState.nightsMode = true;
                    this.gameState.nightsWave = 0;
                    this.gameState.nightsWavesTotal = 5; // default number of nights to survive
                    this.gameState.nightsWaveInProgress = false;
                    this.gameState.nightsEnemiesRemaining = 0;
                    this.gameState.nightsVictory = false;

                    // Spawn an initial small wave to start the night
                    this._startNightsWave();

                    // play a night chime
                    if (this.alertsEnabled) this.playSound('day');
                } catch (err) {
                    console.warn('Nights teleport failed', err);
                }
                return;
            }

            // SNOW / WINTER MAP — applies Christmas visuals, spawns snow enemies (with a hidden Ruin trigger near bushes)
            if (d === 'snow' || d === 'winter' || d === 'snowmap') {
                try {
                    // Move player to snowy field coordinates
                    this.player.mesh.position.set(0, 0, -30);
                    if (this.world) this.world.playerPosition = this.player.mesh.position;

                    // Apply Christmas visuals via world helper
                    if (this.world && typeof this.world.applyChristmas === 'function') {
                        this.world.applyChristmas(true);
                        // mark scene userData so enemy sprite uses snow texture
                        this.scene.userData.christmas = true;
                    } else {
                        // fallback: tint sky and add fog
                        this.scene.background = new THREE.Color(0xE6F3FF);
                        this.scene.fog = new THREE.FogExp2(0xE6F3FF, 0.02);
                    }

                    // Add subtle snowfall sprite plane if not present (non-destructive)
                    if (!this._snowfallPlane) {
                        const snowMat = new THREE.MeshStandardMaterial({ color: 0xFFFFFF, transparent: true, opacity: 0.06 });
                        const snow = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), snowMat);
                        snow.rotation.x = -Math.PI / 2;
                        snow.position.y = 6;
                        snow.receiveShadow = false;
                        this._snowfallPlane = snow;
                        this.scene.add(this._snowfallPlane);
                    }

                    // Instruction UI
                    const instr = document.getElementById('instructions');
                    if (instr) {
                        instr.innerHTML = "SNOW MAP — Winter has come!<br>Watch for frosty infectors and stay warm.";
                        instr.style.background = "rgba(0,0,0,0.55)";
                    }

                    // Spawn a few snow-themed enemies near the player
                    for (let i = 0; i < 8; i++) {
                        const angle = Math.random() * Math.PI * 2;
                        const r = 6 + Math.random() * 14;
                        const spawnPos = new THREE.Vector3(this.player.mesh.position.x + Math.cos(angle) * r, 0, this.player.mesh.position.z + Math.sin(angle) * r);
                        const en = new Enemy(this.scene, spawnPos);
                        // slightly buff and tag as snow wave
                        try { en.speed = (en.speed || 2.5) * (0.9 + Math.random() * 0.6); } catch(e){}
                        this.enemies.push(en);
                    }

                    // Play chilly chime
                    if (this.alertsEnabled) this.playSound('christmas');

                    // --- Easter egg: if player approaches vegetation (bush) in snow, summon Ishoweyes and trigger bad ending ---
                    try {
                        // clear any previous watcher
                        if (this._snowBushWatcher) {
                            clearInterval(this._snowBushWatcher);
                            this._snowBushWatcher = null;
                        }
                        // Check periodically for nearby vegetation within 3.2 units
                        this._snowBushWatcher = setInterval(() => {
                            try {
                                if (!this.world || !Array.isArray(this.world._vegetationItems) || this.world._vegetationItems.length === 0) return;
                                const pPos = this.player.mesh.position;
                                for (const item of this.world._vegetationItems) {
                                    if (!item || !item.position) continue;
                                    const dist = pPos.distanceTo(item.position);
                                    if (dist < 3.2) {
                                        // Found a bush in snow — trigger Ishoweyes bad ending if not already active
                                        if (typeof this.spawnIshoweyesBoss === 'function') {
                                            // make a small announcement then spawn
                                            if (this._announcementText) this._announcementText.textContent = 'Something stirs in the snowy bush...';
                                            // small delay so player sees the message
                                            setTimeout(() => {
                                                try {
                                                    this.spawnIshoweyesBoss();
                                                } catch (e) { console.warn('Failed to spawn Ishoweyes from snow-bush watcher', e); }
                                            }, 700);
                                            // disable watcher after trigger
                                            try { clearInterval(this._snowBushWatcher); this._snowBushWatcher = null; } catch(e){}
                                            return;
                                        }
                                    }
                                }
                            } catch (e) {}
                        }, 600);
                    } catch (e) {
                        console.warn('Failed to setup snow bush watcher', e);
                    }

                } catch (err) {
                    console.warn('Snow teleport failed', err);
                }
                return;
            }

            // DIRT mode (new): dusty ground, hopping enemies that jump toward the player
            if (d === 'dirt') {
                // Mark scene as dirt mode for potential sprite/material decisions
                this.scene.userData.dirtMode = true;

                // Move player to dirt area
                this.player.mesh.position.set(28, 0, 6);
                if (this.world) this.world.playerPosition = this.player.mesh.position;

                // Dirt visuals: muted brown sky and light dust fog
                try {
                    this.scene.background = new THREE.Color(0xCBAE86);
                    this.scene.fog = new THREE.FogExp2(0xCBAE86, 0.025);
                } catch (err) { console.warn(err); }

                // Instruction UI
                const instr = document.getElementById('instructions');
                if (instr) {
                    instr.innerHTML = "DIRT MODE — Beware of burrowing jumpers!<br>Jumping enemies will hop toward you.";
                    instr.style.background = "rgba(80,40,10,0.75)";
                }

                // Spawn several jumping enemies with a hopping behavior
                for (let i = 0; i < 12; i++) {
                    const angle = Math.random() * Math.PI * 2;
                    const r = 8 + Math.random() * 16;
                    const spawnPos = new THREE.Vector3(this.player.mesh.position.x + Math.cos(angle) * r, 0, this.player.mesh.position.z + Math.sin(angle) * r);
                    // create a standard enemy first (fallback if GLTF/sprite specifics are handled in Enemy)
                    const en = new Enemy(this.scene, spawnPos);

                    // Add jumping-specific parameters
                    en.jumping = true;
                    en.jumpCooldown = 0.5 + Math.random() * 1.2; // seconds between hops
                    en.jumpTimer = Math.random() * en.jumpCooldown;
                    en.jumpStrength = 1.2 + Math.random() * 0.8; // vertical hop amplitude
                    en.groundY = en.mesh.position.y || 1.2;
                    // Override update to implement hop + horizontal seek
                    const originalUpdate = en.update.bind(en);
                    en.update = (targetPos, dt) => {
                        if (!en.alive) return;
                        // Horizontal movement towards player but slower while grounded
                        try {
                            const toTarget = new THREE.Vector3().subVectors(targetPos, en.mesh.position);
                            toTarget.y = 0;
                            const dist = toTarget.length();
                            if (dist > 0.1) {
                                toTarget.normalize();
                                // when mid-air, move slightly faster forward to cover ground during hop
                                const speed = en.speed * (en.isAirborne ? 1.5 : 0.9);
                                en.mesh.position.add(toTarget.multiplyScalar(speed * dt));
                            }
                        } catch (err) {}

                        // Jump timing
                        en.jumpTimer -= dt;
                        if (en.jumpTimer <= 0) {
                            // start a jump
                            en.isAirborne = true;
                            en.jumpStart = Date.now();
                            en.jumpDuration = 0.45 + Math.random() * 0.35; // seconds
                            en.jumpTimer = en.jumpCooldown + Math.random() * 1.0;
                        }

                        // If airborne, compute arc progress
                        if (en.isAirborne) {
                            const elapsed = (Date.now() - (en.jumpStart || 0)) / 1000;
                            const t = Math.min(1, elapsed / (en.jumpDuration || 0.5));
                            // simple parabola y = 4h * t * (1 - t)
                            const h = en.jumpStrength;
                            const y = en.groundY + 4 * h * t * (1 - t);
                            en.mesh.position.y = y;
                            if (t >= 1) {
                                en.isAirborne = false;
                                en.mesh.position.y = en.groundY;
                            }
                        } else {
                            // ensure grounded
                            en.mesh.position.y = en.groundY;
                        }

                        // small hover/tilt visual: rotate slightly toward movement direction
                        try {
                            const dir = new THREE.Vector3().subVectors(targetPos, en.mesh.position);
                            dir.y = 0;
                            if (dir.length() > 0.01) {
                                const yaw = Math.atan2(dir.x, dir.z);
                                en.mesh.rotation.y = yaw;
                            }
                        } catch (err) {}

                    };

                    this.enemies.push(en);
                }

                // perk: dust cloud visual (a subtle plane overlay)
                if (!this._dirtDustPlane) {
                    try {
                        const dustMat = new THREE.MeshStandardMaterial({ color: 0xC9A77A, transparent: true, opacity: 0.06 });
                        const dust = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), dustMat);
                        dust.rotation.x = -Math.PI / 2;
                        dust.position.y = 4;
                        this._dirtDustPlane = dust;
                        this.scene.add(this._dirtDustPlane);
                    } catch (e) {}
                }

                // play alert sound
                if (this.alertsEnabled) this.playSound('day');

                return;
            }

            // SQUARE RED ROOMS map — use asset "/Square's red rooms.png" and spawn NPC Square Red (with interactive science quiz)
            if (d === 'square' || d === 'square map' || d === 'square red') {
                try {
                    // position player in the square map area
                    this.player.mesh.position.set(0, 0, 0);
                    if (this.world) this.world.playerPosition = this.player.mesh.position;

                    // load the square background texture and create a backdrop plane if missing
                    try {
                        const loader = new THREE.TextureLoader();
                        const bgTex = loader.load("/Square's red rooms.png");
                        if (!this._squareBackdrop) {
                            const mat = new THREE.MeshBasicMaterial({ map: bgTex, side: THREE.DoubleSide });
                            const plane = new THREE.Mesh(new THREE.PlaneGeometry(220, 120), mat);
                            // place the backdrop behind the scene and high so it reads like a background
                            plane.position.set(0, 40, -90);
                            plane.rotation.y = 0;
                            plane.renderOrder = 0;
                            this._squareBackdrop = plane;
                            this.scene.add(this._squareBackdrop);
                        } else {
                            // update texture if already exists
                            try { this._squareBackdrop.material.map = bgTex; this._squareBackdrop.material.needsUpdate = true; } catch(e){}
                        }
                    } catch (bgErr) {
                        console.warn('Failed to create square backdrop', bgErr);
                    }

                    // spawn or move the Square Red NPC sprite using the same image
                    try {
                        const loader = new THREE.TextureLoader();
                        const npcTex = loader.load("/Square's red rooms.png");
                        const npcMat = new THREE.SpriteMaterial({ map: npcTex, transparent: true });
                        if (!this._squareNpc) {
                            const npc = new THREE.Sprite(npcMat);
                            npc.scale.set(3.6, 3.6, 1);
                            npc.position.set(3, 1.2, 2);
                            npc.name = 'Square Red';
                            npc.userData.dialog = "Yoo! I'm Square Red.";
                            this._squareNpc = npc;
                            this.scene.add(this._squareNpc);
                        } else {
                            // update existing NPC sprite
                            try { this._squareNpc.material = npcMat; this._squareNpc.position.set(3,1.2,2); } catch(e){}
                        }
                    } catch (npcErr) {
                        console.warn('Failed to spawn Square Red NPC', npcErr);
                    }

                    // update HUD instructions for this map
                    const instr = document.getElementById('instructions');
                    if (instr) {
                        instr.innerHTML = "SQUARE RED ROOMS — Meet Square Red NPC!";
                        instr.style.background = "rgba(0,0,0,0.45)";
                    }

                    // Create a simple clickable dialog to start the science quiz
                    const createSquareDialog = () => {
                        let dlg = document.getElementById('square-red-dialog');
                        if (!dlg) {
                            dlg = document.createElement('div');
                            dlg.id = 'square-red-dialog';
                            dlg.style.position = 'fixed';
                            dlg.style.left = '50%';
                            dlg.style.top = '14%';
                            dlg.style.transform = 'translateX(-50%)';
                            dlg.style.zIndex = '10003';
                            dlg.style.background = 'rgba(255,255,255,0.96)';
                            dlg.style.padding = '12px 14px';
                            dlg.style.borderRadius = '10px';
                            dlg.style.boxShadow = '0 8px 24px rgba(0,0,0,0.25)';
                            dlg.style.maxWidth = '420px';
                            dlg.style.fontFamily = 'Segoe UI, Tahoma, sans-serif';
                            dlg.innerHTML = `
                                <div style="font-weight:800;margin-bottom:8px;">Square Red — Quick Science Quiz</div>
                                <div id="square-red-lines" style="font-size:13px;color:#222;line-height:1.4;margin-bottom:10px;">
                                    Hello! I'll teach you some basic science. Ready to try 10 easy questions?
                                </div>
                                <div style="display:flex;gap:8px;justify-content:center;">
                                    <button id="square-start-quiz" style="padding:8px 12px;border-radius:8px;border:0;background:#4CAF50;color:white;cursor:pointer;">Start Quiz</button>
                                    <button id="square-close-quiz" style="padding:8px 12px;border-radius:8px;border:0;background:#f44336;color:white;cursor:pointer;">Close</button>
                                </div>
                            `;
                            document.body.appendChild(dlg);
                        } else {
                            dlg.style.display = 'block';
                        }

                        document.getElementById('square-close-quiz').onclick = () => {
                            try { document.getElementById('square-red-dialog').style.display = 'none'; } catch(e){}
                        };

                        document.getElementById('square-start-quiz').onclick = () => {
                            try { document.getElementById('square-red-dialog').style.display = 'none'; } catch(e){}
                            startScienceQuiz();
                        };
                    };

                    // Quiz implementation: 10 easy multiple-choice questions (A/B/C)
                    const startScienceQuiz = () => {
                        const questions = [
                            { q: "What is H2O commonly called?", a: ["Oxygen","Water","Hydrogen"], correct: 1 },
                            { q: "What planet do we live on?", a: ["Mars","Earth","Venus"], correct: 1 },
                            { q: "What gas do plants take in?", a: ["Carbon Dioxide","Nitrogen","Helium"], correct: 0 },
                            { q: "What force keeps us on the ground?", a: ["Magnetism","Gravity","Friction"], correct: 1 },
                            { q: "What do bees make?", a: ["Silk","Honey","Wax"], correct: 1 },
                            { q: "Which is a mammal?", a: ["Shark","Whale","Tuna"], correct: 1 },
                            { q: "Sun is a ___?", a: ["Planet","Star","Moon"], correct: 1 },
                            { q: "Solid water is called?", a: ["Steam","Ice","Vapor"], correct: 1 },
                            { q: "We breathe to get ___", a: ["Carbon Dioxide","Oxygen","Salt"], correct: 1 },
                            { q: "Seeds grow into ___", a: ["Rocks","Plants","Clouds"], correct: 1 }
                        ];

                        let index = 0;
                        let score = 0;

                        const showQuestion = () => {
                            const q = questions[index];
                            // build modal
                            let m = document.getElementById('square-quiz-modal');
                            if (!m) {
                                m = document.createElement('div');
                                m.id = 'square-quiz-modal';
                                m.style.position = 'fixed';
                                m.style.left = '50%';
                                m.style.top = '18%';
                                m.style.transform = 'translateX(-50%)';
                                m.style.zIndex = '10004';
                                m.style.background = 'rgba(255,255,255,0.98)';
                                m.style.padding = '14px';
                                m.style.borderRadius = '10px';
                                m.style.boxShadow = '0 10px 30px rgba(0,0,0,0.25)';
                                m.style.maxWidth = '520px';
                                m.style.fontFamily = 'Segoe UI, Tahoma, sans-serif';
                                document.body.appendChild(m);
                            }
                            m.innerHTML = `
                                <div style="font-weight:800;margin-bottom:8px;">Science Quiz — Question ${index+1} / ${questions.length}</div>
                                <div id="square-quiz-question" style="font-size:15px;color:#111;margin-bottom:12px;">${q.q}</div>
                                <div style="display:flex;flex-direction:column;gap:8px;">
                                    <button class="sq-choice" data-choice="0" style="padding:8px;border-radius:8px;border:0;background:#e0e0e0;cursor:pointer;text-align:left;">A) ${q.a[0]}</button>
                                    <button class="sq-choice" data-choice="1" style="padding:8px;border-radius:8px;border:0;background:#e0e0e0;cursor:pointer;text-align:left;">B) ${q.a[1]}</button>
                                    <button class="sq-choice" data-choice="2" style="padding:8px;border-radius:8px;border:0;background:#e0e0e0;cursor:pointer;text-align:left;">C) ${q.a[2]}</button>
                                </div>
                                <div style="display:flex;justify-content:flex-end;margin-top:10px;">
                                    <button id="square-quit-quiz" style="padding:6px 10px;border-radius:8px;border:0;background:#f44336;color:white;cursor:pointer;">Quit</button>
                                </div>
                                <div id="square-quiz-feedback" style="margin-top:8px;font-size:13px;color:#444;"></div>
                            `;

                            // attach handlers
                            Array.from(m.querySelectorAll('.sq-choice')).forEach(btn => {
                                btn.onclick = () => {
                                    const choice = Number(btn.dataset.choice);
                                    const correct = q.correct;
                                    const fb = document.getElementById('square-quiz-feedback');
                                    if (choice === correct) {
                                        score++;
                                        fb.textContent = 'Correct!';
                                        fb.style.color = '#2e7d32';
                                    } else {
                                        fb.textContent = `Wrong — correct answer: ${['A','B','C'][correct]}) ${q.a[correct]}`;
                                        fb.style.color = '#b00020';
                                    }
                                    // small delay then next question
                                    setTimeout(() => {
                                        index++;
                                        if (index < questions.length) showQuestion();
                                        else finishQuiz();
                                    }, 900);
                                };
                            });

                            const quitBtn = document.getElementById('square-quit-quiz');
                            quitBtn.onclick = () => {
                                try { document.getElementById('square-quiz-modal').remove(); } catch(e){}
                            };
                        };

                        const finishQuiz = () => {
                            try { document.getElementById('square-quiz-modal').remove(); } catch(e){}
                            // Ask grade
                            let grade = window.prompt(`Quiz complete! Score: ${score}/${questions.length}. What grade are you, dude?`, "6th");
                            if (grade === null) grade = 'Unknown';
                            // show result dialog
                            let r = document.getElementById('square-quiz-result');
                            if (!r) {
                                r = document.createElement('div');
                                r.id = 'square-quiz-result';
                                r.style.position = 'fixed';
                                r.style.left = '50%';
                                r.style.top = '22%';
                                r.style.transform = 'translateX(-50%)';
                                r.style.zIndex = '10005';
                                r.style.background = 'rgba(255,255,255,0.97)';
                                r.style.padding = '12px';
                                r.style.borderRadius = '10px';
                                r.style.boxShadow = '0 8px 24px rgba(0,0,0,0.2)';
                                r.style.maxWidth = '420px';
                                r.style.fontFamily = 'Segoe UI, Tahoma, sans-serif';
                                document.body.appendChild(r);
                            }
                            const percent = Math.round((score / questions.length) * 100);
                            r.innerHTML = `
                                <div style="font-weight:800;margin-bottom:8px;">Quiz Result</div>
                                <div style="font-size:14px;color:#111;margin-bottom:8px;">Score: ${score} / ${questions.length} (${percent}%)</div>
                                <div style="font-size:13px;color:#333;margin-bottom:10px;">Grade: ${String(grade)}</div>
                                <div style="display:flex;justify-content:center;gap:8px;">
                                    <button id="square-result-ok" style="padding:8px 12px;border-radius:8px;border:0;background:#4CAF50;color:white;cursor:pointer;">OK</button>
                                </div>
                            `;
                            document.getElementById('square-result-ok').onclick = () => {
                                try { document.getElementById('square-quiz-result').remove(); } catch(e){}
                                if (this._announcementText) {
                                    this._announcementText.textContent = `Nice! You scored ${score}/${questions.length}.`;
                                    setTimeout(() => { try { this._announcementText.textContent = 'UPDATES MORE SOON!'; } catch(e){} }, 2000);
                                }
                            };
                        };

                        // start first question
                        showQuestion();
                    };

                    // Make the NPC interactive: clicking (or approaching) opens the dialog
                    // Simple proximity + click: show dialog when player is near or when pressing 'F' while nearby
                    const showIfNearby = () => {
                        try {
                            if (!this._squareNpc) return;
                            const d = this.player.mesh.position.distanceTo(this._squareNpc.position);
                            if (d < 3.0) {
                                createSquareDialog();
                            } else {
                                // if too far, show a short hint
                                if (this._announcementText) {
                                    this._announcementText.textContent = "Approach Square Red to learn science!";
                                    setTimeout(() => { try { this._announcementText.textContent = 'UPDATES MORE SOON!'; } catch(e){} }, 1400);
                                }
                            }
                        } catch (e) {}
                    };

                    // Bind key 'f' to interact
                    window.addEventListener('keydown', (ev) => {
                        if (ev.key && (ev.key === 'f' || ev.key === 'F')) {
                            try { showIfNearby(); } catch(e){}
                        }
                    });

                    // Also create a lightweight click handler on the NPC sprite by raycasting on mousedown
                    const raycaster = new THREE.Raycaster();
                    const mouse = new THREE.Vector2();
                    const onMouseDown = (ev) => {
                        try {
                            mouse.x = (ev.clientX / window.innerWidth) * 2 - 1;
                            mouse.y = - (ev.clientY / window.innerHeight) * 2 + 1;
                            raycaster.setFromCamera(mouse, this.camera);
                            const intersects = raycaster.intersectObject(this._squareNpc, true);
                            if (intersects && intersects.length) {
                                createSquareDialog();
                            }
                        } catch (e) {}
                    };
                    window.addEventListener('mousedown', onMouseDown);

                } catch (err) {
                    console.warn('Square teleport failed', err);
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
        // --- Fan Oise easter egg: track continuous walking time to spawn fan-made character
        // initialize walking tracker on first run
        if (typeof this._fanWalkTimer === 'undefined') {
            this._fanWalkTimer = 0; // seconds walked (accumulated)
            this._fanLastPos = this.player && this.player.mesh ? this.player.mesh.position.clone() : new THREE.Vector3();
            this._fanSpawned = false;
            // the URL to open when bomb hits the fan-made character
            this._fanWatchedUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
            this._fanSequenceActive = false;
        }
        // Count movement distance this frame; if the player is moving (distance > small threshold), add dt to timer
        try {
            if (this.player && this.player.mesh && !this._fanSpawned) {
                const curPos = this.player.mesh.position;
                const moved = curPos.distanceTo(this._fanLastPos || curPos);
                // threshold to consider "walking" (small jitter ignored)
                if (moved > 0.02) {
                    this._fanWalkTimer += dt;
                } else {
                    // small pause resets progressive requirement (require near-continuous walking)
                    this._fanWalkTimer = Math.max(0, this._fanWalkTimer - dt * 0.2);
                }
                this._fanLastPos.copy(curPos);
                // if walked 11 seconds continuously (approximately), spawn the Fan Oise sprite
                if (this._fanWalkTimer >= 11 && !this._fanSpawned) {
                    try {
                        const loader = new THREE.TextureLoader();
                        const tex = loader.load('/TheFan oise Timer.png');
                        const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
                        const fan = new THREE.Sprite(mat);
                        fan.scale.set(3.6, 3.6, 1);
                        fan.position.copy(this.player.mesh.position).add(new THREE.Vector3(0, 0.9, -2));
                        fan.userData.isFanOise = true;
                        // mark as not pettable / silent
                        fan.userData.canBePetted = false;
                        fan.userData.canSpeak = false;
                        // default chase properties
                        fan.userData.chase = false;
                        fan.userData.chaseSpeed = 3.2;
                        fan.userData._lastMove = Date.now();
                        // store for later checks (bomb collision)
                        this._fanOise = fan;
                        this.scene.add(fan);
                        this._fanSpawned = true;
                        if (this._announcementText) {
                            this._announcementText.textContent = 'You found a hidden fan-made character...';
                            setTimeout(()=>{ try{ this._announcementText.textContent='UPDATES MORE SOON!'; }catch(e){} }, 2600);
                        }
                    } catch (e) { console.warn('Failed to spawn Fan Oise', e); }
                }
            }

            // If Fan Oise was triggered into chase sequence, move it towards the player and check capture
            try {
                if (this._fanOise && this._fanOise.userData && this._fanOise.userData.chase) {
                    const fan = this._fanOise;
                    const speed = (fan.userData.chaseSpeed || 4.0);
                    // compute direction on XZ plane
                    const dir = new THREE.Vector3().subVectors(this.player.mesh.position, fan.position);
                    dir.y = 0;
                    if (dir.length() > 0.05) {
                        dir.normalize();
                        // nudge fan toward player
                        fan.position.add(dir.multiplyScalar(speed * dt));
                        // small bob
                        fan.position.y = 0.9 + Math.abs(Math.sin(Date.now() * 0.005)) * 0.06;
                    }
                    // check collision: if fan touches player -> kick/redirect
                    const dist = fan.position.distanceTo(this.player.mesh.position);
                    if (dist < 1.0 && !this._fanCaptureHandled) {
                        this._fanCaptureHandled = true;
                        try {
                            // remove pets and cleanup visuals
                            const petKeys = ['cashy','builderG','dancingBanana','babyCapybara','parrot','chromebook'];
                            petKeys.forEach(k => {
                                try {
                                    if (this.world && this.world[k]) {
                                        try { this.scene.remove(this.world[k]); } catch (e) {}
                                        this.world[k] = null;
                                    }
                                } catch (e) {}
                            });
                            // announce and redirect to given URL after tiny delay so player's browser can respond
                            if (this._announcementText) this._announcementText.textContent = 'Caught by Fan Oise — You have been kicked!';
                            // stop background btye audio if any
                            try { if (this._btyeAudio && this._btyeAudio.pause) { this._btyeAudio.pause(); this._btyeAudio.src = ''; this._btyeAudio = null; } } catch(e){}
                            // cleanup overlay
                            try { const gd = document.getElementById('gdi-overlay'); if (gd) { gd.style.display = 'none'; } } catch(e){}
                            // redirect
                            setTimeout(() => {
                                try { window.location.href = 'https://www.youtube.com/watch?v=0qWlZM2QkdA'; } catch (e) {}
                            }, 450);
                        } catch (e) { console.warn('Fan capture handling failed', e); }
                    }
                }
            } catch (e) {}
        } catch (e) {}
        // initialize one-time trackers
        if (!this._killTracker) this._killTracker = new WeakMap();
        if (!this._fastModeSession) this._fastModeSession = { active: false, kills: 0 };

        // Fast Infectors detection heuristic: treated as active when spawn threshold <= 0.6 and survival is active
        const isFastInfectorsActive = () => {
            return (this.enemySpawnThreshold !== undefined && this.enemySpawnThreshold <= 0.6 && this.gameState.isSurvival);
        };

        // Early exit if game over — but if IShowThemes is active, show an inescapable looping video overlay (one-time create)
        if (this.gameState.gameOver) {
            try {
                if (this.gameState.ishowTheme) {
                    // create or show full-screen video overlay that loops infinitely
                    let vwrap = document.getElementById('ish-video-overlay');
                    if (!vwrap) {
                        vwrap = document.createElement('div');
                        vwrap.id = 'ish-video-overlay';
                        vwrap.style.position = 'fixed';
                        vwrap.style.inset = '0';
                        vwrap.style.zIndex = '200000';
                        vwrap.style.background = '#000';
                        vwrap.style.display = 'flex';
                        vwrap.style.alignItems = 'center';
                        vwrap.style.justifyContent = 'center';
                        vwrap.style.pointerEvents = 'auto';
                        vwrap.style.cursor = 'default';
                        // video element
                        const vid = document.createElement('video');
                        vid.id = 'ish-video';
                        vid.src = '/ifoundeishoweyes.mp4';
                        vid.loop = true;
                        vid.muted = false;
                        vid.autoplay = true;
                        vid.style.width = '100%';
                        vid.style.height = '100%';
                        vid.style.objectFit = 'cover';
                        vid.setAttribute('playsinline', '');
                        // prevent user from pausing via context menu by capturing events
                        vid.oncontextmenu = (e) => { e.preventDefault(); };
                        vwrap.appendChild(vid);
                        document.body.appendChild(vwrap);
                        // try to play immediately (best-effort)
                        try { vid.play().catch(()=>{}); } catch(e){}
                    } else {
                        const vid = document.getElementById('ish-video');
                        if (vid) try { vid.play().catch(()=>{}); } catch(e){}
                        vwrap.style.display = 'flex';
                    }
                    // prevent escape: disable common UI elements (best-effort)
                    try {
                        const menu = document.getElementById('main-menu'); if (menu) menu.style.display = 'none';
                        const pause = document.getElementById('pause-menu'); if (pause) pause.style.display = 'none';
                        // remove key handlers that toggle overlays lightly (best-effort)
                        // note: full prevention of user from closing page is impossible in browser, but we hide in-game UI.
                    } catch(e){}
                }
            } catch(e){}
            return;
        }

        // Detect enemy deaths this frame and update achievement counters
        try {
            // ensure newly spawned enemies are tracked
            this.enemies.forEach(en => {
                if (en && en.alive && !this._killTracker.has(en)) {
                    this._killTracker.set(en, true); // mark as seen alive
                }
            });

            // For any enemy that transitioned from alive to dead, count as a kill
            for (const en of Array.from(this.enemies)) {
                try {
                    const seen = this._killTracker.has(en);
                    const alive = !!(en && en.alive);
                    if (seen && !alive) {
                        // enemy just died (transition)
                        // if we're in fast infectors survival, increment session kills
                        if (isFastInfectorsActive()) {
                            this._fastModeSession.kills = (this._fastModeSession.kills || 0) + 1;
                            // update best if applicable
                            if ((this._fastModeSession.kills || 0) > (this.achievements.fastInfectorsBestKills || 0)) {
                                this.achievements.fastInfectorsBestKills = this._fastModeSession.kills;
                                this.saveAchievements();
                            }
                        }
                        // clean tracker for this enemy
                        try { this._killTracker.delete(en); } catch(e){}
                    }
                } catch (e) {}
            }
        } catch (e) {
            // non-fatal
        }

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

        // --- Challenge Time mode timer and collection handling (new)
        try {
            if (this.gameState.challengeTimeSeconds !== undefined) {
                // decrement challenge time
                this.gameState.challengeTimeSeconds -= dt;
                if (this.gameState.challengeTimeSeconds < 0) this.gameState.challengeTimeSeconds = 0;
                // update instructions red timer display as MM:SS
                const ct = Math.max(0, Math.ceil(this.gameState.challengeTimeSeconds));
                const mm = String(Math.floor(ct / 60)).padStart(2, '0');
                const ss = String(ct % 60).padStart(2, '0');
                const instr = document.getElementById('instructions');
                if (instr) instr.innerHTML = `CHALLENGE TIME • Red Timer: ${mm}:${ss} • Clocks: ${this.gameState.challengeClocksCollected || 0}/${this.gameState.challengeClocksTotal || 5}`;

                // check clock pickups (player proximity)
                if (Array.isArray(this._challengeClocks)) {
                    for (const clk of Array.from(this._challengeClocks)) {
                        try {
                            if (!clk || clk.userData.collected) continue;
                            const d = this.player.mesh.position.distanceTo(clk.position);
                            if (d < 1.4) {
                                clk.userData.collected = true;
                                try { this.scene.remove(clk); } catch(e){}
                                this.gameState.challengeClocksCollected = (this.gameState.challengeClocksCollected || 0) + 1;
                                // spawn small feedback diamond or effect
                                this.spawnDiamondAt(this.player.mesh.position.clone().add(new THREE.Vector3(0,2,0)));
                                if (this._announcementText) this._announcementText.textContent = `Clock collected! (${this.gameState.challengeClocksCollected}/${this.gameState.challengeClocksTotal})`;
                                setTimeout(()=>{ try{ this._announcementText.textContent='UPDATES MORE SOON!'; }catch(e){} }, 1600);
                            }
                        } catch (e) {}
                    }
                    // if all clocks collected, spawn portal once
                    if ((this.gameState.challengeClocksCollected || 0) >= (this.gameState.challengeClocksTotal || 5) && !this.gameState.challengePortal) {
                        this._spawnChallengePortal();
                    }
                }

                // portal interaction: approach portal to trigger unavoidable boss teleport
                if (this.gameState.challengePortal) {
                    try {
                        const portal = this.gameState.challengePortal;
                        const d = this.player.mesh.position.distanceTo(portal.position);
                        if (d < 2.2) {
                            // teleport into unavoidable boss encounter: pick a heavy boss sequence
                            // remove portal and clocks state to prevent repeat
                            try { this.scene.remove(portal); } catch(e){}
                            this.gameState.challengePortal = null;
                            // Mark that player cannot escape; force survival and spawn a boss army
                            this.gameState.noEscape = true;
                            this.gameState.isSurvival = true;
                            // spawn a mixed severe boss event: James + Tan + Castle siege
                            try { if (typeof this.spawnJamesBoss === 'function') this.spawnJamesBoss(); } catch(e){}
                            try { if (typeof this.spawnTanBoss === 'function') this.spawnTanBoss(); } catch(e){}
                            try { if (typeof this.spawnCastleInfectors === 'function') this.spawnCastleInfectors(28); } catch(e){}
                            // spawn additional enemies for pressure
                            const p = this.player.mesh.position.clone();
                            for (let i=0;i<28;i++) {
                                const angle = Math.random() * Math.PI * 2;
                                const r = 6 + Math.random() * 22;
                                const spawnPos = new THREE.Vector3(p.x + Math.cos(angle) * r, 0, p.z + Math.sin(angle) * r);
                                this.enemies.push(new Enemy(this.scene, spawnPos));
                            }
                            // Update UI and enforce no escape by disabling teleport overrides
                            try {
                                window._teleportOverride = null;
                            } catch(e){}
                            if (this._announcementText) {
                                this._announcementText.textContent = 'Portal teleported you to the final onslaught — you cannot escape!';
                                setTimeout(()=>{ try{ this._announcementText.textContent='UPDATES MORE SOON!'; }catch(e){} }, 4000);
                            }
                        }
                    } catch (e) {}
                }

                // if the challenge timer expires before collecting clocks -> force immediate failure / spawn Ishoweyes penalty
                if (this.gameState.challengeTimeSeconds <= 0) {
                    // fail condition: spawn a heavy punishment (IShowEyes) and mark game over
                    try {
                        if (typeof this.spawnIshoweyesBoss === 'function') this.spawnIshoweyesBoss();
                        this.gameState.gameOver = true;
                        const instrEl = document.getElementById('instructions');
                        if (instrEl) instrEl.innerHTML = 'CHALLENGE FAILED — The red timer ended and the world glitched.';
                        if (this._announcementText) this._announcementText.textContent = 'Challenge Time failed — bad ending triggered.';
                        // clean up clocks list
                        try { this._challengeClocks = []; } catch(e){}
                    } catch (e) { console.warn('Challenge fail handling error', e); }
                }
            }
        } catch (e) {
            console.warn('Challenge Time update error', e);
        }

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

        // --- NIGHTS / CAMPFIRE mode handling ---
        if (this.gameState.nightsMode) {
            // If no wave is in progress and nights remain, start a new wave
            if (!this.gameState.nightsWaveInProgress && this.gameState.nightsWave < this.gameState.nightsWavesTotal) {
                this._startNightsWave();
            }

            // Check victory: if all waves done and no enemies left
            if (this.gameState.nightsWave >= (this.gameState.nightsWavesTotal || 0) && this.enemies.filter(e => e.alive).length === 0 && !this.gameState.nightsVictory) {
                this.gameState.nightsVictory = true;
                this.gameState.nightsMode = false;
                // restore day visuals
                try {
                    this.scene.background = new THREE.Color(0x87CEEB);
                    this.scene.fog = new THREE.Fog(0x87CEEB, 20, 50);
                } catch (e) {}
                const instr = document.getElementById('instructions');
                if (instr) {
                    instr.innerHTML = "NIGHTS WON — You survived all nights! Returning to base.";
                    instr.style.background = "rgba(0,128,0,0.7)";
                }
                // reward points and remove campfire
                this.gameState.points = (this.gameState.points || 0) + 3;
                if (this._pointsEl) this._pointsEl.textContent = this.gameState.points;
                try { if (this._campfireGroup) { this.scene.remove(this._campfireGroup); this._campfireGroup = null; } } catch(e){}
                // optional sound
                if (this.alertsEnabled) this.playSound('day');
            }
        }

        // --- Yellower falling-enemies survival challenge handling ---
        if (this.gameState.survivalFalling) {
            try {
                // decrement timer
                this.gameState.survivalFallingTime -= dt;
                const instr = document.getElementById('instructions');
                if (instr) instr.innerHTML = `YELLOWER CHALLENGE — Survive: ${Math.max(0, Math.ceil(this.gameState.survivalFallingTime))}s • HP: ${Math.max(0, this.gameState.playerHP)}`;

                // spawn falling enemy occasionally (every ~0.9s)
                this._fallSpawnTimer = (this._fallSpawnTimer || 0) + dt;
                if (this._fallSpawnTimer > 0.9) {
                    this._fallSpawnTimer = 0;
                    // spawn a falling enemy at a random XZ above the scene
                    const angle = Math.random() * Math.PI * 2;
                    const r = 6 + Math.random() * 12;
                    const spawnX = this.player.mesh.position.x + Math.cos(angle) * r;
                    const spawnZ = this.player.mesh.position.z + Math.sin(angle) * r;
                    // create a lightweight "falling" enemy as a small red sprite that falls from Y=12
                    try {
                        const tex = new THREE.TextureLoader().load('/unused png.png');
                        const mat = new THREE.SpriteMaterial({ map: tex, color: 0xff3333 });
                        const sp = new THREE.Sprite(mat);
                        sp.scale.set(1.2, 1.2, 1);
                        sp.position.set(spawnX, 12, spawnZ);
                        sp.userData.falling = true;
                        sp.userData.groundY = 1.2;
                        sp.userData.speed = 9 + Math.random() * 6;
                        this.scene.add(sp);
                        // add to enemies array as a simple object with update/destroy to integrate with loop
                        const fe = {
                            alive: true,
                            mesh: sp,
                            speed: sp.userData.speed,
                            update: (targetPos, dtdt) => {
                                if (!fe.alive) return;
                                // fall faster each frame
                                sp.position.y -= sp.userData.speed * dtdt;
                                // small horizontal drift toward player
                                const toP = new THREE.Vector3().subVectors(this.player.mesh.position, sp.position);
                                toP.y = 0;
                                if (toP.length() > 0.1) toP.normalize().multiplyScalar(0.6 * dtdt);
                                sp.position.add(toP);
                                // on reaching ground
                                if (sp.position.y <= sp.userData.groundY) {
                                    // check distance to player
                                    const dist = sp.position.distanceTo(this.player.mesh.position);
                                    if (dist < 1.4) {
                                        // damage player
                                        this.gameState.playerHP -= 18; // damage amount
                                        // announcement
                                        const instr2 = document.getElementById('instructions');
                                        if (instr2) instr2.innerHTML = `You were hit! HP: ${Math.max(0, this.gameState.playerHP)} • Survive: ${Math.max(0, Math.ceil(this.gameState.survivalFallingTime))}s`;
                                    }
                                    // create small impact visual (brief)
                                    try {
                                        const g = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), new THREE.MeshStandardMaterial({ color: 0xffaa66 }));
                                        g.position.copy(sp.position);
                                        this.scene.add(g);
                                        setTimeout(() => { try { this.scene.remove(g); } catch(e){} }, 300);
                                    } catch(e){}
                                    // remove falling sprite
                                    try { this.scene.remove(sp); } catch(e){}
                                    fe.alive = false;
                                }
                            },
                            destroy: () => {
                                fe.alive = false;
                                try { this.scene.remove(sp); } catch(e){}
                            }
                        };
                        this.enemies.push(fe);
                    } catch (e) {
                        console.warn('Failed to spawn falling enemy', e);
                    }
                }

                // Check for player death
                if (this.gameState.playerHP <= 0) {
                    this.gameState.survivalFalling = false;
                    this.gameState.gameOver = true;
                    const instr2 = document.getElementById('instructions');
                    if (instr2) instr2.innerHTML = "GAME OVER — You were defeated in the Yellower challenge.";
                    // cleanup any remaining falling sprites
                    try {
                        this.enemies.forEach(en => { if (en && en.userData && en.userData.falling && en.mesh) { try { this.scene.remove(en.mesh); } catch(e){} } });
                    } catch(e){}
                }

                // Win condition
                if (this.gameState.survivalFallingTime <= 0 && this.gameState.playerHP > 0) {
                    this.gameState.survivalFalling = false;
                    // reward points and restore visuals
                    this.gameState.points = (this.gameState.points || 0) + 2;
                    if (this._pointsEl) this._pointsEl.textContent = this.gameState.points;
                    const instr2 = document.getElementById('instructions');
                    if (instr2) instr2.innerHTML = "CHALLENGE COMPLETE — You survived Yellower Town!";
                    // remove leftover falling sprites
                    try {
                        this.enemies = this.enemies.filter(en => {
                            if (!en || !en.alive) return false;
                            // keep non-falling enemies; remove falling ones
                            const isF = (en.mesh && en.mesh.userData && en.mesh.userData.falling);
                            if (isF) {
                                try { this.scene.remove(en.mesh); } catch(e){}
                                return false;
                            }
                            return true;
                        });
                    } catch (e) {}
                    // restore sky
                    try {
                        this.scene.background = new THREE.Color(0x87CEEB);
                        this.scene.fog = new THREE.Fog(0x87CEEB, 20, 50);
                    } catch(e){}
                    if (this.alertsEnabled) this.playSound('day');
                }
            } catch (e) {
                console.warn('Yellower survival update error', e);
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

                // If we're in a Chapter 2 build flow, advance short demo days toward the chapter2 target
                if (this.gameState.chapter2Building) {
                    // advance day count up to target
                    if (this.gameState.day < (this.gameState.chapter2DaysTarget || 4)) {
                        this.gameState.day++;
                        document.getElementById('day-counter').textContent = this.gameState.day;
                        // advance visuals accordingly
                        this.world.advanceGrowth(this.gameState.day);
                        this.world.advanceHouse(this.gameState.day);
                        const plantStages = ["Seed", "Sprout", "Sapling", "Bush", "Tree", "Fruiting Tree", "Majestic Tree"];
                        const houseStages = ["Blueprint", "Foundation", "Framework", "Walls", "Roofing", "Finishing", "Completed!"];
                        document.getElementById('plant-stage').textContent = plantStages[Math.min(plantStages.length-1, this.gameState.day - 1)];
                        document.getElementById('house-stage').textContent = houseStages[Math.min(houseStages.length-1, this.gameState.day - 1)];
                        // gentle tick sound each short day
                        this.playSound('day');
                    } else {
                        // Completed the 4 build days: trigger Chapter 2 finale
                        try {
                            this.gameState.chapter2Building = false;
                            // play Field of Ambush music
                            this.playSound('field');
                            // spawn a fast swarm of red infectors to create tension
                            const p = this.player.mesh.position.clone();
                            // Load the red infector texture once, then spawn fast red-infected enemies
                            let redTex = null;
                            try {
                                redTex = new THREE.TextureLoader().load('/red infectors.png');
                            } catch (texErr) {
                                redTex = null;
                                console.warn('Failed to load red infectors texture', texErr);
                            }

                            for (let i = 0; i < 28; i++) {
                                try {
                                    const angle = Math.random() * Math.PI * 2;
                                    const r = 6 + Math.random() * 18;
                                    const spawnPos = new THREE.Vector3(p.x + Math.cos(angle) * r, 0, p.z + Math.sin(angle) * r);
                                    const en = new Enemy(this.scene, spawnPos);
                                    en.speed = (en.speed || 2.5) * 2.2; // make them much faster

                                    // apply red infector skin if texture loaded
                                    try {
                                        if (redTex && en.mesh && en.mesh.material) {
                                            en.mesh.material.map = redTex;
                                            en.mesh.material.needsUpdate = true;
                                        }
                                    } catch (texErr) {
                                        // ignore if texture application fails
                                    }

                                    this.enemies.push(en);
                                } catch (e) {
                                    console.warn('Failed to spawn red infector instance', e);
                                }
                            }

                            // play Chapter 2 finale music (Field of Ambush) and give a dramatic announcement
                            try {
                                this.playSound('field');
                            } catch (e) { console.warn('Failed to play Chapter 2 field music', e); }

                            if (this._announcementText) {
                                this._announcementText.textContent = 'House build complete — RED INFECTORS accelerate! Survive the ambush.';
                                setTimeout(()=>{ try{ this._announcementText.textContent='UPDATES MORE SOON!'; }catch(e){} }, 4000);
                            }

                            // set survival state and tighten spawn thresholds
                            this.gameState.isSurvival = true;
                            this.enemySpawnThreshold = 0.4;
                        } catch (finishErr) {
                            console.warn('Chapter 2 finale failed', finishErr);
                        }
                    }
                } else {
                    // Normal day progression
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
                        try {
                            // Play the Field of Ambush music when the final day ends and the enemy wave begins
                            if (typeof this.playSound === 'function') this.playSound('field');
                        } catch (e) { console.warn('Failed to play field music on day 7', e); }
                    }
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

                if (this.world && this.world.cashy) {
                    const distToCashy = enemy.mesh.position.distanceTo(this.world.cashy.position);
                    if (distToCashy < 1) {
                        // damage Cashy instead of instant game over
                        try {
                            const pet = this.world.cashy;
                            pet.hp = (pet.hp === undefined) ? 100 : pet.hp;
                            pet.hp -= 25; // damage per hit
                            // small visual feedback: tint
                            try { pet.material.color.setHex(0xffaaaa); } catch(e){}
                            setTimeout(() => { try { pet.material.color.setHex(0xffffff); } catch(e){} }, 300);
                            // destroy the enemy that hit
                            try { enemy.destroy(); } catch (e) { if (enemy.mesh) try { this.scene.remove(enemy.mesh); } catch(e){} }
                            // if pet HP depleted, mark capture / game over
                            if (pet.hp <= 0) {
                                this.gameState.gameOver = true;
                                document.getElementById('instructions').innerHTML = "GAME OVER<br>Cashy was captured! Refresh to restart.";
                            }
                        } catch (e) {
                            // fallback: if anything fails, preserve original behavior
                            this.gameState.gameOver = true;
                            document.getElementById('instructions').innerHTML = "GAME OVER<br>Cashy was captured! Refresh to restart.";
                        }
                    }
                }
                // Check collision with player: if an enemy reaches the player, damage player HP
                try {
                    const distToPlayer = enemy.mesh.position.distanceTo(this.player.mesh.position);
                    if (distToPlayer < 1) {
                        // ensure player has hp
                        this.player.hp = (this.player.hp === undefined) ? 100 : this.player.hp;
                        this.player.hp -= 20;
                        // remove enemy after hit
                        try { enemy.destroy(); } catch(e) { if (enemy.mesh) try { this.scene.remove(enemy.mesh); } catch(e){} }
                        // UI feedback
                        const instrEl = document.getElementById('instructions');
                        if (instrEl) {
                            instrEl.innerHTML = `Player hit! HP: ${Math.max(0, this.player.hp)}`;
                            instrEl.style.background = "rgba(0,0,0,0.5)";
                        }
                        if (this.player.hp <= 0) {
                            this.gameState.gameOver = true;
                            document.getElementById('instructions').innerHTML = "GAME OVER<br>Your Capybara fell in battle! Refresh to restart.";
                        }
                    }
                } catch (e) {}
            });

            // G-Defense logic (with Jam Event: Builder G becomes Kung-Fu during event when fighting enemies)
            const distToG = pPos.distanceTo(this.world.builderG.position);
            if (distToG < 2.5) {
                this.world.builderG.material.color.setHex(0x00ffff);
                const target = this.enemies.find(e => e.alive && e.mesh && e.mesh.position && e.mesh.position.distanceTo(this.world.builderG.position) < 10);
                if (target) {
                    // If Jam Event active, transform Builder G into Kung-Fu mode before he fights
                    try {
                        if (this.jamEvent && this.jamEvent.active) {
                            try { this.transformBuilderToKungFu && this.transformBuilderToKungFu(); } catch (e) { console.warn('Kung-Fu transform failed', e); }
                        }
                    } catch (e) {}
                    this.world.showGBeam(target.mesh.position);
                    // damage/kill the target as before
                    try {
                        if (typeof target.takeDamage === 'function') {
                            // prefer takeDamage if enemy exposes it
                            target.takeDamage(9999);
                        } else if (typeof target.destroy === 'function') {
                            target.destroy();
                        } else if (target.mesh) {
                            try { this.scene.remove(target.mesh); } catch(e) {}
                        }
                    } catch (e) {
                        try { if (target.destroy) target.destroy(); } catch(e){}
                    }
                    // event sound + normal plant sound
                    try { if (this.jamEvent && this.jamEvent.active) this.playSound('day'); } catch(e){}
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
                // pet sound removed intentionally
                this.world.cashy.bounce();
                setTimeout(() => { this.world.cashy.isPetting = false; }, 1000);
            }
        }

        if (this.world.builderG) {
            const builderDist = pPos.distanceTo(this.world.builderG.position);
            if (builderDist < 1.5 && !this.world.builderG.isPetting) {
                this.world.builderG.isPetting = true;
                this.gameState.pets++;
                document.getElementById('pet-counter').textContent = this.gameState.pets;
                // pet sound removed intentionally
                this.world.builderG.bounce();
                setTimeout(() => { this.world.builderG.isPetting = false; }, 1000);
            }
        }

        // Baby capybara interaction: counts as a pet but NO pet sound should play
        if (this.world.babyCapybara) {
            try {
                const babyDist = pPos.distanceTo(this.world.babyCapybara.position);
                if (babyDist < 1.5 && !this.world.babyCapybara.isPetting) {
                    this.world.babyCapybara.isPetting = true;
                    this.gameState.pets++;
                    document.getElementById('pet-counter').textContent = this.gameState.pets;
                    // Intentionally do NOT call playSound('pet') for baby capybara
                    // gentle visual bounce
                    if (typeof this.world.babyCapybara.bounce === 'function') {
                        this.world.babyCapybara.bounce();
                    } else {
                        // small velocity bump to simulate bounce
                        this.world.babyCapybara.velocity = 0.18;
                    }
                    setTimeout(() => { this.world.babyCapybara.isPetting = false; }, 1000);
                }
            } catch (e) {}
        }

        // Puppet pet: touching the puppet will cause the player to wear it (attach puppet sprite to player) and count as a pet without playing a pet sound.
        if (this.world.puppet) {
            try {
                const pupDist = pPos.distanceTo(this.world.puppet.position);
                if (pupDist < 1.5 && !this.world.puppet.isPetting) {
                    this.world.puppet.isPetting = true;
                    this.gameState.pets = (this.gameState.pets || 0) + 1;
                    try { document.getElementById('pet-counter').textContent = this.gameState.pets; } catch(e){}
                    // attach a worn puppet sprite to the player if not already wearing one
                    try {
                        if (!this.player.wornPuppet) {
                            // clone puppet sprite material onto a small sprite attached to player
                            const texLoader = new THREE.TextureLoader();
                            const tex = texLoader.load('/amber puppet.jpg');
                            const sprMat = new THREE.SpriteMaterial({ map: tex, transparent: true });
                            const worn = new THREE.Sprite(sprMat);
                            worn.name = 'worn-puppet';
                            worn.scale.set(1.2, 1.2, 1);
                            // parent to player's mesh so it follows the player
                            this.player.mesh.add(worn);
                            // position the puppet on player's head area (local coordinates)
                            worn.position.set(0, 0.9, 0.6);
                            this.player.wornPuppet = worn;
                        } else {
                            // if already wearing, refresh slight bounce
                            try { this.player.wornPuppet.scale.set(1.25, 1.25, 1); setTimeout(()=>{ this.player.wornPuppet.scale.set(1.2,1.2,1); },120); } catch(e){}
                        }
                    } catch (attachErr) { console.warn('Failed to attach worn puppet', attachErr); }

                    // gentle visual bounce on puppet
                    try {
                        if (typeof this.world.puppet.bounce === 'function') this.world.puppet.bounce();
                        else this.world.puppet.velocity = 0.12;
                    } catch(e){}

                    // clear petting flag after short delay
                    setTimeout(() => { try { this.world.puppet.isPetting = false; } catch(e){} }, 1000);
                }
            } catch (e) {}
        }

        // HOSTILE Poison Dart Frogs handling (spawned by Mushroom Gnomes theme)
        try {
            if (this.world && Array.isArray(this.world._poisonFrogs) && this.world._poisonFrogs.length) {
                for (const pf of Array.from(this.world._poisonFrogs)) {
                    try {
                        if (!pf || !pf.position) continue;
                        // reproduction: occasional spawn nearby
                        if (pf.userData && pf.userData.reproduce && Math.random() < 0.002) {
                            // small chance to reproduce per frame tick; spawn near parent
                            const ang = Math.random() * Math.PI * 2;
                            const rr = 1.2 + Math.random() * 1.6;
                            const pos = new THREE.Vector3(pf.position.x + Math.cos(ang) * rr, 0.9, pf.position.z + Math.sin(ang) * rr);
                            // reuse world helper
                            try { if (this.world && typeof this.world._spawnSinglePoisonFrog === 'function') this.world._spawnSinglePoisonFrog(pos); } catch(e){}
                        }

                        // attack pets or player if in range (frogs are immune)
                        const targets = [];
                        // player
                        targets.push({ type: 'player', pos: this.player.mesh.position, takeDamage: (d) => { this.player.hp = (this.player.hp===undefined)?100:this.player.hp - d; if (this.player.hp <= 0) { this.gameState.gameOver = true; document.getElementById('instructions').innerHTML = 'GAME OVER — Poisoned! Refresh to retry.'; } } });
                        // pets list
                        ['cashy','builderG','dancingBanana','babyCapybara','chromebook'].forEach(k => {
                            try {
                                const pet = this.world[k];
                                if (pet && pet.position) targets.push({ type: k, pos: pet.position, ref: pet, takeDamage: (d) => { pet.hp = (pet.hp===undefined)?100:pet.hp - d; if (pet.hp <= 0) { try { this.scene.remove(pet); } catch(e){} this.world[k] = null; } } });
                            } catch (e) {}
                        });

                        for (const t of targets) {
                            try {
                                const d = pf.position.distanceTo(t.pos);
                                if (d < 2.0) {
                                    // apply toxin damage (small tick)
                                    if (!pf.userData._lastPoison || (Date.now() - pf.userData._lastPoison) > 900) {
                                        pf.userData._lastPoison = Date.now();
                                        // Poison effect: damage and short status text
                                        const dmg = 12;
                                        t.takeDamage(dmg);
                                        if (this._announcementText) {
                                            this._announcementText.textContent = `Poison Dart Frog hit ${t.type}! -${dmg} HP`;
                                            setTimeout(()=>{ try{ this._announcementText.textContent='UPDATES MORE SOON!'; }catch(e){} }, 1600);
                                        }
                                    }
                                }
                            } catch (e) {}
                        }

                        // basic idle bob
                        pf.position.y = 0.9 + Math.abs(Math.sin(Date.now() * 0.01 + (pf.userData._phase||0))) * 0.06;
                    } catch (e) {}
                }
            }
        } catch (e) { console.warn('Poison frog update error', e); }

        // Try to spawn the easter key when a tree/vegetation is visible and not spawned yet
        try {
            // spawn key when player has moved around a bit and vegetation exists
            if (!this.easterKey && !this.easterKeyPicked) {
                // player must be within general world area to "see" trees: distance check to any vegetation
                if (this.world && Array.isArray(this.world._vegetationItems) && this.world._vegetationItems.length > 0) {
                    // if any vegetation is within 18 units of player, spawn key near a random one
                    const near = this.world._vegetationItems.find(it => it && it.position && this.player.mesh.position.distanceTo(it.position) < 18);
                    if (near) this.spawnKeyNearTreeIfVisible();
                }
            }
        } catch (e) {}

        // Key pickup handling: if key exists and player is close, pick it up, unlock door and make Builder G speak
        try {
            if (this.easterKey && !this.easterKeyPicked) {
                const kd = this.player.mesh.position.distanceTo(this.easterKey.position);
                if (kd < 1.2) {
                    // pick up key
                    try {
                        this.easterKeyPicked = true;
                        // remove key sprite
                        try { this.scene.remove(this.easterKey); } catch (e) {}
                        this.easterKey = null;
                        // unlock the easter door if present
                        if (this._easterDoor) {
                            this._easterDoor.userData.locked = false;
                            // animate door opening by moving it aside
                            const targetPos = this._easterDoor.position.clone().add(new THREE.Vector3(0.9, 0, 0));
                            const start = Date.now();
                            const dur = 600;
                            const tick = () => {
                                const t = Math.min(1, (Date.now() - start) / dur);
                                this._easterDoor.position.lerpVectors(this._easterDoor.position, targetPos, t);
                                if (t < 1) requestAnimationFrame(tick);
                            };
                            tick();
                        }
                        // notify player and builder G speaks via TTS
                        if (this._announcementText) {
                            this._announcementText.textContent = "You picked up a key! Builder G: Hey who is taking the key?";
                            setTimeout(()=>{ try{ this._announcementText.textContent='UPDATES MORE SOON!'; }catch(e){} }, 3000);
                        }
                        // Builder G voice line
                        this.playBuilderGVoice("Hey who is taking the key?");
                    } catch (e) { console.warn('Key pickup failed', e); }
                } else {
                    // subtle sparkle bob to hint visibility
                    try {
                        if (this.easterKey) this.easterKey.position.y = 0.8 + Math.abs(Math.sin(Date.now() * 0.01)) * 0.08;
                    } catch (e) {}
                }
            }
        } catch (e) {}

        // Frogs interaction: petting frogs increments pet counter but intentionally does NOT play the generic pet sound.
        // Additionally frogs will attack nearby enemies (simple behavior invoked here).
        if (this.world.frogs && this.world.frogs.length) {
            try {
                this.world.frogs.forEach((frog) => {
                    try {
                        // Petting by player (no pet sound)
                        const frogDist = pPos.distanceTo(frog.position);
                        if (frogDist < 1.4 && !frog.isPetting) {
                            frog.isPetting = true;
                            this.gameState.pets++;
                            document.getElementById('pet-counter').textContent = this.gameState.pets;
                            // visual bounce
                            try { frog.velocity = 0.16; } catch(e){}
                            setTimeout(() => { frog.isPetting = false; }, 1000);
                        }

                        // Frog attack: find nearest enemy within a small radius and make the frog perform a jump attack.
                        if (this.enemies && this.enemies.length) {
                            // find nearest alive enemy
                            let nearest = null;
                            let nd = Infinity;
                            for (const en of this.enemies) {
                                if (!en || !en.alive) continue;
                                try {
                                    const pos = en.mesh ? en.mesh.position : (en.position || new THREE.Vector3());
                                    const d = pos.distanceTo(frog.position);
                                    if (d < nd) { nd = d; nearest = en; }
                                } catch (e) {}
                            }
                            // if an enemy is reasonably close, perform an attack jump
                            if (nearest && nd < 6 && !frog._attackCooldown) {
                                // trigger frog jump visually (force airborne)
                                frog.isAirborne = true;
                                frog.jumpStart = Date.now();
                                frog.jumpDuration = 0.28;
                                frog.jumpStrength = 1.2;
                                frog._attackCooldown = true;
                                setTimeout(() => { frog._attackCooldown = false; }, 900);

                                // damage bosses or kill normal enemies; frogs cannot insta-delete bosses
                                try {
                                    // If target exposes takeDamage, prefer that (bosses)
                                    if (nearest && (nearest.takeDamage || nearest.hp !== undefined || nearest.isBoss || nearest.name === 'James')) {
                                        try {
                                            if (typeof nearest.takeDamage === 'function') {
                                                // small frog attack damage
                                                nearest.takeDamage();
                                            } else if (nearest.hp !== undefined) {
                                                nearest.hp -= 8; // small frog damage
                                                // if hp drops to zero, destroy properly
                                                if (nearest.hp <= 0) {
                                                    if (nearest.destroy) nearest.destroy();
                                                    else if (nearest.mesh) try { this.scene.remove(nearest.mesh); } catch(e){}
                                                }
                                            } else {
                                                // fallback: mark not killed by frogs
                                                // do nothing special to prevent frogs from instantly removing bosses
                                            }
                                        } catch (innerE) {
                                            // fallback to safe removal for non-bosses
                                            try { if (nearest.destroy) nearest.destroy(); else if (nearest.mesh) this.scene.remove(nearest.mesh); } catch(e){}
                                        }
                                    } else {
                                        // normal enemy: remove
                                        if (nearest.destroy) nearest.destroy();
                                        else if (nearest.mesh) this.scene.remove(nearest.mesh);
                                    }
                                } catch (e) {}
                                try { this.playSound('plant'); } catch (e) {}

                                // small hop visual effect: nudge frog upward immediately
                                frog.position.y = frog.originalY + 0.6;
                            }
                        }
                    } catch (e) {}
                });
            } catch (e) {}
        }

        // Halloween pumpkin pickup: collect jack-o'-lanterns to protect pets temporarily
        try {
            if (this.world && Array.isArray(this.world.halloweenPumpkins) && this.world.halloweenPumpkins.length) {
                for (const pk of Array.from(this.world.halloweenPumpkins)) {
                    try {
                        if (!pk || pk.userData.collected) continue;
                        const d = this.player.mesh.position.distanceTo(pk.position);
                        if (d < 1.4) {
                            // collect pumpkin
                            pk.userData.collected = true;
                            try { this.scene.remove(pk); } catch(e){}
                            // apply pet protection buff for 20 seconds
                            const durationMs = 20000;
                            this.world.petsProtectedUntil = Date.now() + durationMs;
                            // visual/announcement feedback
                            if (this._announcementText) {
                                this._announcementText.textContent = 'Collected Jack-o\'-lantern — your pets are protected for 20s!';
                                setTimeout(() => { try { this._announcementText.textContent = 'UPDATES MORE SOON!'; } catch(e){} }, 3000);
                            }
                            // small effect: make pets briefly glow (best-effort)
                            try {
                                ['cashy','builderG','dancingBanana','babyCapybara','chromebook'].forEach(k => {
                                    const pet = this.world[k];
                                    if (!pet) return;
                                    try {
                                        if (pet.material && pet.material.color) {
                                            pet.userData._origColor = pet.material.color.clone ? pet.material.color.clone() : pet.material.color;
                                            pet.material.color.lerp(new THREE.Color(0xffff88), 0.9);
                                            setTimeout(() => {
                                                try {
                                                    if (pet.material && pet.userData && pet.userData._origColor) pet.material.color.copy(pet.userData._origColor);
                                                } catch(e){}
                                            }, durationMs);
                                        }
                                    } catch (e) {}
                                });
                            } catch (e) {}
                        }
                    } catch (e) {}
                }
                // clean up collected pumpkins array periodically
                this.world.halloweenPumpkins = this.world.halloweenPumpkins.filter(p => p && !p.userData.collected);
            }
            // enforce protection effects: while protected, prevent enemies from instantly killing pets (simple flag)
            if (this.world && this.world.petsProtectedUntil && Date.now() < this.world.petsProtectedUntil) {
                // this is a passive flag used in other logic paths (e.g. enemy hits on pets check this flag)
                // here we ensure the pet-counter UI shows protection
                try {
                    const petCounterEl = document.getElementById('pet-counter');
                    if (petCounterEl) petCounterEl.style.textShadow = '0 0 6px rgba(255,200,80,0.9)';
                } catch (e) {}
            } else {
                // remove special UI when expired
                try {
                    const petCounterEl = document.getElementById('pet-counter');
                    if (petCounterEl) petCounterEl.style.textShadow = '';
                    if (this.world) this.world.petsProtectedUntil = 0;
                } catch (e) {}
            }
        } catch (e) {}

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

        // First-person movement & look handling (when enabled)
        if (this.firstPerson) {
            try {
                // handle look rotation: apply yaw/pitch to camera
                const yaw = this.fpYaw || 0;
                const pitch = this.fpPitch || 0;
                // clamp pitch to [-85deg, 85deg]
                const maxPitch = Math.PI * 0.47;
                const clampedPitch = Math.max(-maxPitch, Math.min(maxPitch, pitch));
                // set camera orientation using quaternion
                const q = new THREE.Quaternion();
                q.setFromEuler(new THREE.Euler(clampedPitch, yaw, 0, 'YXZ'));
                this.camera.quaternion.copy(q);

                // movement: WASD / arrow keys
                const speed = (this.player && this.player.speed) ? this.player.speed * 1.0 : 5.0;
                const moveDir = new THREE.Vector3();
                if (this.fpKeys && this.fpKeys.forward) moveDir.z -= 1;
                if (this.fpKeys && this.fpKeys.back) moveDir.z += 1;
                if (this.fpKeys && this.fpKeys.left) moveDir.x -= 1;
                if (this.fpKeys && this.fpKeys.right) moveDir.x += 1;
                if (moveDir.lengthSq() > 0.001) {
                    moveDir.normalize();
                    // transform moveDir by camera yaw only (ignore pitch)
                    const yawQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0), yaw);
                    moveDir.applyQuaternion(yawQuat);
                    // move player and camera
                    const displacement = moveDir.multiplyScalar(speed * dt);
                    this.player.mesh.position.add(displacement);
                    if (this.world) this.world.playerPosition = this.player.mesh.position;
                }
                // ensure camera follows player's eye position smoothly
                const eyeOffset = new THREE.Vector3(0, 1.25, 0);
                const targetCam = this.player.mesh.position.clone().add(eyeOffset);
                this.camera.position.lerp(targetCam, 0.45);
            } catch (e) {}
        } else {
            this.player.update(this.input, dt);
        }
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

/**
 * Start Nightmare mode: darken sky, lightning strikes, then spawn an infectors wave after 10s.
 */
Game.prototype.startNightmareMode = function () {
    try {
        // Apply dramatic visuals
        this.scene.background = new THREE.Color(0x05040a); // very dark
        this.scene.fog = new THREE.FogExp2(0x05040a, 0.08);
        if (this._announcementText) {
            this._announcementText.textContent = 'Nightmare incoming — lightning in 10s!';
        }

        // Lightning helper: a few quick flashes over the 10s period
        const flashes = 6;
        for (let i = 0; i < flashes; i++) {
            const delayMs = 300 + Math.floor(Math.random() * 800) + Math.floor((i / flashes) * 9000);
            setTimeout(() => {
                try {
                    const originalAmbient = this.scene.children.find(c=>c.type==='AmbientLight');
                    const originalDir = this.scene.children.find(c=>c.type==='DirectionalLight');
                    if (originalAmbient) originalAmbient.intensity = 1.6;
                    if (originalDir) originalDir.intensity = 2.3;

                    // small camera shake visual
                    const cam = this.camera;
                    const origPos = cam.position.clone();
                    cam.position.x += (Math.random() - 0.5) * 0.6;
                    cam.position.y += (Math.random() - 0.5) * 0.6;
                    cam.position.z += (Math.random() - 0.5) * 0.6;

                    setTimeout(() => {
                        try {
                            if (originalAmbient) originalAmbient.intensity = 0.8;
                            if (originalDir) originalDir.intensity = 1.0;
                            cam.position.copy(origPos);
                        } catch (e) {}
                    }, 120);
                } catch (e) {}
            }, delayMs);
        }

        // After visual build-up, spawn diverse nightmare infectors (flying & pogo)
        setTimeout(() => {
            try {
                if (this._announcementText) this._announcementText.textContent = 'INFECTORS: The nightmare wave has arrived!';
                const p = this.player.mesh.position.clone();

                // Spawn ground infectors (standard)
                for (let i = 0; i < 18; i++) {
                    const angle = Math.random() * Math.PI * 2;
                    const r = 6 + Math.random() * 14;
                    const spawnPos = new THREE.Vector3(p.x + Math.cos(angle) * r, 0, p.z + Math.sin(angle) * r);
                    this.enemies.push(new Enemy(this.scene, spawnPos));
                }

                // Spawn flying infectors: lightweight objects that move in 3D (Y oscillation)
                for (let i = 0; i < 8; i++) {
                    const angle = Math.random() * Math.PI * 2;
                    const r = 8 + Math.random() * 18;
                    const spawnPos = new THREE.Vector3(p.x + Math.cos(angle) * r, 6 + Math.random() * 4, p.z + Math.sin(angle) * r);
                    // lightweight flying enemy object
                    const fly = {
                        alive: true,
                        speed: 3.2 + Math.random() * 1.6,
                        mesh: null,
                        update: null,
                        destroy: null
                    };
                    // create a simple sprite for flying infector
                    try {
                        const tex = new THREE.TextureLoader().load('/unused png.png');
                        const mat = new THREE.SpriteMaterial({ map: tex, color: 0xff4444 });
                        const spr = new THREE.Sprite(mat);
                        spr.scale.set(1.6, 1.6, 1);
                        spr.position.copy(spawnPos);
                        this.scene.add(spr);
                        fly.mesh = spr;
                        // movement: seek player in XZ while bobbing in Y, can descend to attack briefly
                        let attackCooldown = 0;
                        fly.update = (targetPos, dt) => {
                            if (!fly.alive) return;
                            try {
                                const dir = new THREE.Vector3().subVectors(targetPos, fly.mesh.position);
                                const horiz = new THREE.Vector3(dir.x, 0, dir.z);
                                if (horiz.length() > 0.1) horiz.normalize();
                                fly.mesh.position.add(horiz.multiplyScalar(fly.speed * dt));
                                // bobbing Y motion
                                fly.mesh.position.y = 4.5 + Math.sin(Date.now() * 0.004 + (i)) * 1.2;
                                // occasional dive attack if close and cooldown elapsed
                                const dist = targetPos.distanceTo(fly.mesh.position);
                                attackCooldown -= dt;
                                if (dist < 3.2 && attackCooldown <= 0) {
                                    attackCooldown = 2.0 + Math.random() * 1.6;
                                    // quick dive toward player then retreat: implement as a tween-like sequence
                                    const start = fly.mesh.position.clone();
                                    const dirToPlayer = new THREE.Vector3().subVectors(targetPos.clone().add(new THREE.Vector3(0,0.8,0)), start).normalize();
                                    const diveSpeed = 9 + Math.random() * 4;
                                    // apply immediate position nudge (simple instant damage check)
                                    fly.mesh.position.add(dirToPlayer.clone().multiplyScalar(1.2));
                                    // damage if overlapping
                                    try {
                                        if (fly.mesh.position.distanceTo(this.player.mesh.position) < 1.0) {
                                            this.player.hp = (this.player.hp === undefined) ? 100 : this.player.hp;
                                            this.player.hp -= 18;
                                            if (this.player.hp <= 0) {
                                                this.gameState.gameOver = true;
                                                document.getElementById('instructions').innerHTML = "GAME OVER<br>Your Capybara fell in battle! Refresh to restart.";
                                            }
                                        }
                                    } catch (e) {}
                                }
                            } catch (e) {}
                        };
                        fly.destroy = () => {
                            fly.alive = false;
                            try { this.scene.remove(fly.mesh); } catch (e) {}
                        };
                    } catch (err) {
                        console.warn('Failed to spawn flying infector sprite, fallback to ground enemy', err);
                        const fallback = new Enemy(this.scene, spawnPos.clone());
                        fallback.speed = 3.2;
                        this.enemies.push(fallback);
                        continue;
                    }
                    this.enemies.push(fly);
                }

                // Spawn pogo-jumping infectors: hop toward the player with vertical arcs
                for (let i = 0; i < 8; i++) {
                    const angle = Math.random() * Math.PI * 2;
                    const r = 10 + Math.random() * 16;
                    const spawnPos = new THREE.Vector3(p.x + Math.cos(angle) * r, 0, p.z + Math.sin(angle) * r);
                    // create a standard enemy and augment with pogo behavior
                    const en = new Enemy(this.scene, spawnPos);
                    en.jumping = true;
                    en.jumpCooldown = 0.6 + Math.random() * 0.9; // seconds between hops
                    en.jumpTimer = Math.random() * en.jumpCooldown;
                    en.jumpStrength = 1.8 + Math.random() * 1.0; // vertical hop amplitude
                    en.groundY = en.mesh.position.y || 1.2;
                    // override update to implement hop + horizontal seek
                    const originalUpdate = en.update.bind(en);
                    en.update = (targetPos, dt) => {
                        if (!en.alive) return;
                        try {
                            // horizontal seeking when grounded, faster mid-air
                            const toTarget = new THREE.Vector3().subVectors(targetPos, en.mesh.position);
                            toTarget.y = 0;
                            const dist = toTarget.length();
                            if (dist > 0.1) {
                                toTarget.normalize();
                                const speed = en.speed * (en.isAirborne ? 1.6 : 1.0);
                                en.mesh.position.add(toTarget.multiplyScalar(speed * dt));
                            }
                        } catch (err) {}
                        // Jump timing
                        en.jumpTimer -= dt;
                        if (en.jumpTimer <= 0) {
                            en.isAirborne = true;
                            en.jumpStart = Date.now();
                            en.jumpDuration = 0.36 + Math.random() * 0.36;
                            en.jumpTimer = en.jumpCooldown + Math.random() * 1.0;
                        }
                        // If airborne, compute arc
                        if (en.isAirborne) {
                            const elapsed = (Date.now() - (en.jumpStart || 0)) / 1000;
                            const t = Math.min(1, elapsed / (en.jumpDuration || 0.5));
                            const h = en.jumpStrength;
                            en.mesh.position.y = en.groundY + 4 * h * t * (1 - t);
                            if (t >= 1) {
                                en.isAirborne = false;
                                en.mesh.position.y = en.groundY;
                            }
                        } else {
                            en.mesh.position.y = en.groundY;
                        }
                        // small rotate toward movement direction
                        try {
                            const dir = new THREE.Vector3().subVectors(targetPos, en.mesh.position);
                            dir.y = 0;
                            if (dir.length() > 0.01) {
                                const yaw = Math.atan2(dir.x, dir.z);
                                en.mesh.rotation.y = yaw;
                            }
                        } catch (err) {}
                    };
                    this.enemies.push(en);
                }

                // intensify spawn rate & set survival
                this.enemySpawnThreshold = 0.35;
                this.gameState.isSurvival = true;

                // play chase music if enabled
                if (this.alertsEnabled) this.playSound('jelly');

            } catch (e) {
                console.warn('Nightmare wave spawn failed', e);
            }
        }, 10000);
    } catch (e) {
        console.warn('startNightmareMode failed', e);
    }
};

Game.prototype.saveCampaign = function () {
    try {
        if (!this.campaignState) return;
        this.campaignState.savedAt = Date.now();
        localStorage.setItem('capybara_campaign_save', JSON.stringify(this.campaignState));
        if (this._announcementText) {
            this._announcementText.textContent = 'Campaign progress saved.';
            setTimeout(() => { try { this._announcementText.textContent = 'UPDATES MORE SOON!'; } catch(e){} }, 1400);
        }
    } catch (e) {
        console.warn('saveCampaign failed', e);
    }
};

Game.prototype.loadCampaign = function () {
    try {
        const raw = localStorage.getItem('capybara_campaign_save');
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        this.campaignState = Object.assign(this.campaignState || {}, parsed);
        if (this._announcementText) {
            const lvl = (this.campaignState.level === 0) ? 'Tutorial' : `Level ${this.campaignState.level}`;
            this._announcementText.textContent = `Campaign loaded — ${lvl}`;
            setTimeout(() => { try { this._announcementText.textContent = 'UPDATES MORE SOON!'; } catch(e){} }, 1400);
        }
        return this.campaignState;
    } catch (e) {
        console.warn('loadCampaign failed', e);
        return null;
    }
};

// Toggle and update hitbox visuals for enemies and key scene objects
Game.prototype.updateHitboxes = function (enable) {
    try {
        // Helper to add a BoxHelper for a mesh and store reference
        const makeHelper = (obj) => {
            if (!obj || !obj.mesh && !obj.isMesh && !obj.geometry && !obj.material && !obj.position) return null;
            try {
                // if object is a wrapper with .mesh, use that; otherwise assume it's a mesh/sprite/group
                const target = obj.mesh ? obj.mesh : obj;
                // remove old helper if present
                if (target.userData._hitboxHelper) {
                    try { this.scene.remove(target.userData._hitboxHelper); } catch(e){}
                    target.userData._hitboxHelper = null;
                }
                if (!enable) return null;
                // For sprites and groups, use Box3 helper wireframe via BoxHelper
                const box = new THREE.Box3().setFromObject(target);
                const size = new THREE.Vector3();
                box.getSize(size);
                const boxHelper = new THREE.Box3Helper(box, new THREE.Color(0x00ff00));
                // attach helper to scene at correct transform
                this.scene.add(boxHelper);
                target.userData._hitboxHelper = boxHelper;
                return boxHelper;
            } catch (e) { return null; }
        };

        // Remove all existing hitbox helpers if disabling
        if (!enable) {
            // Enemies
            if (this.enemies && this.enemies.length) {
                this.enemies.forEach(en => {
                    try {
                        const target = en.mesh ? en.mesh : en;
                        if (target && target.userData && target.userData._hitboxHelper) {
                            this.scene.remove(target.userData._hitboxHelper);
                            target.userData._hitboxHelper = null;
                        }
                    } catch (e) {}
                });
            }
            // World pets/objects
            const world = this.world;
            if (world) {
                const candidates = ['cashy','builderG','dancingBanana','parrot','timeG','babyCapybara'];
                candidates.forEach(k => {
                    try {
                        const obj = world[k];
                        if (!obj) return;
                        const target = obj.mesh ? obj.mesh : obj;
                        if (target && target.userData && target.userData._hitboxHelper) {
                            this.scene.remove(target.userData._hitboxHelper);
                            target.userData._hitboxHelper = null;
                        }
                    } catch(e){}
                });
            }
            return;
        }

        // When enabling, create helpers for enemies and main interactive objects
        if (this.enemies && this.enemies.length) {
            this.enemies.forEach(en => {
                try {
                    const target = en.mesh ? en.mesh : en;
                    // update or create helper
                    if (target) {
                        // remove any existing helper first
                        if (target.userData && target.userData._hitboxHelper) {
                            try { this.scene.remove(target.userData._hitboxHelper); } catch(e){}
                            target.userData._hitboxHelper = null;
                        }
                        // create box3 helper and keep updating it each frame via stored flag
                        const box = new THREE.Box3().setFromObject(target);
                        const helper = new THREE.Box3Helper(box, new THREE.Color(0xff4444));
                        this.scene.add(helper);
                        if (!target.userData) target.userData = {};
                        target.userData._hitboxHelper = helper;
                        // store reference so animate loop can refresh helper bounds
                        target.userData._hitboxNeedsUpdate = true;
                    }
                } catch (e) {}
            });
        }

        // Add helpers for some world interactive objects (green)
        if (this.world) {
            ['cashy','builderG','dancingBanana','parrot','timeG','babyCapybara'].forEach(k => {
                try {
                    const obj = this.world[k];
                    if (!obj) return;
                    const target = obj.mesh ? obj.mesh : obj;
                    if (!target) return;
                    if (target.userData && target.userData._hitboxHelper) {
                        try { this.scene.remove(target.userData._hitboxHelper); } catch(e){}
                        target.userData._hitboxHelper = null;
                    }
                    const box = new THREE.Box3().setFromObject(target);
                    const helper = new THREE.Box3Helper(box, new THREE.Color(0x00ff88));
                    this.scene.add(helper);
                    if (!target.userData) target.userData = {};
                    target.userData._hitboxHelper = helper;
                    target.userData._hitboxNeedsUpdate = true;
                } catch (e) {}
            });
        }
    } catch (e) {
        console.warn('updateHitboxes error', e);
    }
};

/* Boss fight helpers: spawn James, Mouthy (existing), or Infector King (castle siege).
   Adds a simple boss selection dialog and spawn functions to kick off a focused boss encounter.
*/
Game.prototype.spawnJamesBoss = function () {
    try {
        // Remove any existing boss instances for clarity
        if (this._jamesBoss && this._jamesBoss.alive) {
            try { this._jamesBoss.destroy(); } catch (e) {}
        }

        // Create James sprite from asset (James.jpeg)
        const tex = new THREE.TextureLoader().load('/James.jpeg');
        const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
        const sprite = new THREE.Sprite(mat);
        sprite.scale.set(6, 6, 1);
        // Position above and in front of player
        const p = this.player.mesh.position.clone();
        sprite.position.set(p.x + 8, 4.5, p.z + 4);
        this.scene.add(sprite);

        // boss object with stealing behavior
        const boss = {
            name: 'James',
            alive: true,
            mesh: sprite,
            hp: 90000,
            phase: 0,
            attackTimer: 0.9,
            carrying: null, // reference to stolen object (sprite/mesh)
            carryOffset: new THREE.Vector3(0, -1.6, 0),
            update: (targetPos, dt) => {
                if (!boss.alive) return;
                try {
                    // If carrying something, keep it attached under James
                    if (boss.carrying) {
                        try {
                            // follow boss position (slightly beneath)
                            boss.carrying.position.copy(boss.mesh.position).add(boss.carryOffset);
                            // keep carried object slightly rotated/disabled for interactions
                            if (boss.carrying.userData) boss.carrying.userData.stolen = true;
                        } catch (e) {}
                    } else {
                        // attempt to steal nearby high-value targets (Cashy, Builder G, or player)
                        try {
                            // prefer Cashy, then BuilderG, then player
                            const candidates = [];
                            if (this.world && this.world.cashy) candidates.push({ key: 'cashy', obj: this.world.cashy });
                            if (this.world && this.world.builderG) candidates.push({ key: 'builderG', obj: this.world.builderG });
                            // NOTE: do not include the player as a stealable candidate to avoid James carrying the player

                            for (const c of candidates) {
                                try {
                                    if (!c.obj || !c.obj.position) continue;
                                    const d = boss.mesh.position.distanceTo(c.obj.position);
                                    if (d < 2.2) {
                                        // steal it
                                        boss.carrying = c.obj;
                                        // detach from world references so AI targets it as taken
                                        if (c.key === 'cashy') {
                                            try { this.world.cashy = null; } catch (e) {}
                                        } else if (c.key === 'builderG') {
                                            try { this.world.builderG = null; } catch (e) {}
                                        } else if (c.key === 'player') {
                                            // visually the player is carried but gameplay continues: freeze player's movement briefly
                                            try { this.player.speed = Math.max(0, this.player.speed - 4); } catch(e){}
                                        }
                                        // mark stolen and give visual feedback
                                        try {
                                            if (!boss.carrying.userData) boss.carrying.userData = {};
                                            boss.carrying.userData.stolen = true;
                                            boss.carrying.userData.stolenBy = 'James';
                                        } catch (e) {}
                                        if (this._announcementText) {
                                            this._announcementText.textContent = `James stole ${c.key === 'player' ? 'you' : c.key}! Defeat him to get it back.`;
                                            setTimeout(()=>{ try{ this._announcementText.textContent = 'UPDATES MORE SOON!'; }catch(e){} }, 3000);
                                        }
                                        // break after first successful steal
                                        break;
                                    }
                                } catch (e) {}
                            }
                        } catch (e) {}
                    }

                    // Movement: approach target (player) when not circling; circle if close
                    const dir = new THREE.Vector3().subVectors(targetPos, boss.mesh.position);
                    const horiz = new THREE.Vector3(dir.x, 0, dir.z);
                    const dist = horiz.length();
                    if (dist > 6) {
                        horiz.normalize();
                        boss.mesh.position.add(horiz.multiplyScalar(2.2 * dt));
                    } else {
                        const angle = 0.8 * dt;
                        boss.mesh.position.applyAxisAngle(new THREE.Vector3(0,1,0), angle);
                        boss.mesh.position.y = 4.5 + Math.sin(Date.now()*0.002)*0.6;
                    }

                    // attack cadence: strong melee lash that intensifies by phase
                    boss.attackTimer -= dt;
                    if (boss.attackTimer <= 0) {
                        boss.attackTimer = 1.2 - Math.min(0.7, boss.phase * 0.12);
                        const pd = boss.mesh.position.distanceTo(this.player.mesh.position);
                        if (pd < 3.2) {
                            this.player.hp = (this.player.hp === undefined) ? 100 : this.player.hp;
                            const dmg = 22 + boss.phase * 8;
                            this.player.hp -= dmg;
                            if (this.player.hp <= 0) {
                                this.gameState.gameOver = true;
                                try { document.getElementById('instructions').innerHTML = "GAME OVER — Defeated by James!"; } catch(e){}
                            }
                        }
                        try {
                            boss.mesh.scale.set(8,8,1);
                            setTimeout(()=>{ try{ boss.mesh.scale.set(6,6,1);}catch(e){} }, 180);
                        } catch(e){}
                    }

                    // phase increase when low HP
                    if (boss.hp <= 280 && boss.phase === 0) boss.phase = 1;
                    if (boss.hp <= 140 && boss.phase === 1) boss.phase = 2;
                } catch (err) {}
            },
            takeDamage: () => {
                boss.hp -= 60;
                if (boss.hp <= 0) {
                    boss.alive = false;
                    // on death, drop carried object back to world or near player
                    try {
                        if (boss.carrying) {
                            const carried = boss.carrying;
                            // place returned object near the player's position
                            const dropPos = this.player.mesh.position.clone().add(new THREE.Vector3(1.2, 0, 0));
                            carried.position.copy(dropPos);
                            // clear stolen flags
                            try { if (carried.userData) { carried.userData.stolen = false; carried.userData.stolenBy = null; } } catch(e){}
                            // restore world references if it was a pet
                            if (carried === this.world?.cashyprev) {
                                // no-op (not used)
                            }
                            // Best-effort: if the carried object has a name, restore to world slot
                            try {
                                if (carried && carried.name && carried.name.toLowerCase().includes('cashy')) this.world.cashy = carried;
                                if (carried && carried.name && carried.name.toLowerCase().includes('builder')) this.world.builderG = carried;
                                // if the player mesh was carried, restore player speed
                                if (carried === this.player.mesh) {
                                    try { this.player.speed = 5; } catch(e){}
                                }
                            } catch(e){}
                            boss.carrying = null;
                        }
                    } catch (e) {}
                    try { this.scene.remove(boss.mesh); } catch(e) {}
                
                    // Unlock Chapter 2 when James is defeated and persist achievement
                    try {
                        this.achievements = this.achievements || {};
                        this.achievements.chapter2Unlocked = true;
                        if (typeof this.saveAchievements === 'function') this.saveAchievements();
                        // also set a localStorage marker for external UI
                        try { localStorage.setItem('capybara_achievements', JSON.stringify(this.achievements)); } catch(e){}
                        // call UI helper if present to update menu UI
                        try { if (window._unlockChapter2) window._unlockChapter2(); } catch(e){}
                    } catch (e) { console.warn('Failed to unlock chapter 2 on James death', e); }
                }
                if (boss.hp <= 300) boss.phase = Math.max(boss.phase,1);
                if (boss.hp <= 120) boss.phase = Math.max(boss.phase,2);
            },
            destroy: () => {
                // on manual destroy, ensure carried object is returned
                try {
                    if (boss.carrying) {
                        const carried = boss.carrying;
                        const dropPos = this.player.mesh.position.clone().add(new THREE.Vector3(1.2, 0, 0));
                        try { carried.position.copy(dropPos); } catch(e){}
                        try { if (carried.userData) { carried.userData.stolen = false; carried.userData.stolenBy = null; } } catch(e){}
                        // restore common world references when sensible
                        try {
                            if (carried && carried.name && carried.name.toLowerCase().includes('cashy')) this.world.cashy = carried;
                            if (carried && carried.name && carried.name.toLowerCase().includes('builder')) this.world.builderG = carried;
                            if (carried === this.player.mesh) { try { this.player.speed = 5; } catch(e){} }
                        } catch(e){}
                        boss.carrying = null;
                    }
                } catch (e) {}
                boss.alive = false;
                try { this.scene.remove(boss.mesh); } catch(e){}
            }
        };

        this._jamesBoss = boss;
        this.enemies.push(boss);

        if (this._announcementText) {
            this._announcementText.textContent = 'BOSS FIGHT — James has arrived!';
            setTimeout(()=>{ try{ this._announcementText.textContent = 'UPDATES MORE SOON!'; }catch(e){} }, 2200);
        }
        // ensure survival state and cinematic visuals
        this.gameState.isSurvival = true;
        this.scene.background = new THREE.Color(0x1a0b12);
        this.scene.fog = new THREE.FogExp2(0x1a0b12, 0.06);
        if (this.alertsEnabled) this.playSound('day');
    } catch (e) { console.warn('spawnJamesBoss failed', e); }
};

Game.prototype.spawnTanBoss = function () {
    try {
        // Remove existing Tan instance if present
        if (this._tanBoss && this._tanBoss.alive) {
            try { this._tanBoss.destroy(); } catch (e) {}
        }

        // Use TextureLoader with callbacks so sprite is only created after texture loads
        const loader = new THREE.TextureLoader();
        const path = '/Tan The Orange (2).png';
        // Position reference for where to spawn once texture is ready
        const p = (this.player && this.player.mesh) ? this.player.mesh.position.clone() : new THREE.Vector3(0,0,0);

        loader.load(path, (tex) => {
            try {
                const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
                const sprite = new THREE.Sprite(mat);
                sprite.scale.set(5.2, 5.2, 1);
                // Position slightly in front of player
                sprite.position.set(p.x + 10, 4.8, p.z + 6);
                this.scene.add(sprite);

                // boss object (same as before but referencing the created sprite)
                const boss = {
                    name: 'Tan The Orange',
                    alive: true,
                    mesh: sprite,
                    hp: 190,
                    attackTimer: 1.4,
                    fireCooldown: 1.4,
                    fireTimer: 0.8,
                    spawnFlame: (startPos, targetPos) => {
                        try {
                            const fMat = new THREE.MeshStandardMaterial({ color: 0x8e44ad, emissive: 0x6a0dad, emissiveIntensity: 1.6 });
                            const fGeo = new THREE.SphereGeometry(0.28, 8, 8);
                            const ball = new THREE.Mesh(fGeo, fMat);
                            ball.position.copy(startPos);
                            const dir = new THREE.Vector3().subVectors(targetPos.clone().add(new THREE.Vector3(0, 0.9, 0)), startPos).normalize();
                            ball.userData.dir = dir;
                            ball.userData.speed = 9 + Math.random() * 3;
                            ball.userData.owner = 'tan';
                            ball.userData.spawnTime = Date.now();
                            ball.userData.maxLifeMs = 20000;
                            this.scene.add(ball);

                            const proj = {
                                alive: true,
                                mesh: ball,
                                update: (tp, dt) => {
                                    if (!proj.alive) return;
                                    proj.mesh.position.add(proj.mesh.userData.dir.clone().multiplyScalar(proj.mesh.userData.speed * dt));
                                    if (Date.now() - (proj.mesh.userData.spawnTime || 0) > (proj.mesh.userData.maxLifeMs || 20000)) {
                                        proj.alive = false;
                                        try { this.scene.remove(proj.mesh); } catch (e) {}
                                        return;
                                    }
                                    try {
                                        if (proj.mesh.position.distanceTo(this.player.mesh.position) < 1.1) {
                                            this.player.hp = (this.player.hp === undefined) ? 100 : this.player.hp;
                                            this.player.hp -= 227;
                                            proj.alive = false;
                                            try { this.scene.remove(proj.mesh); } catch (e) {}
                                            if (this.player.hp <= 0) {
                                                this.gameState.gameOver = true;
                                                const instr = document.getElementById('instructions');
                                                if (instr) instr.innerHTML = "KILLED BY TAN THE ORANGE! Refresh to retry.";
                                            }
                                            return;
                                        }
                                        const pets = ['cashy','builderG','babyCapybara','dancingBanana'];
                                        for (const petKey of pets) {
                                            const pet = this.world[petKey];
                                            if (!pet) continue;
                                            if (proj.mesh.position.distanceTo(pet.position) < 1.1) {
                                                pet.hp = (pet.hp === undefined) ? 100 : pet.hp;
                                                pet.hp -= 227;
                                                proj.alive = false;
                                                try { this.scene.remove(proj.mesh); } catch (e) {}
                                                if (pet.hp <= 0) {
                                                    try { this.scene.remove(pet); this.world[petKey] = null; } catch (e) {}
                                                }
                                                return;
                                            }
                                        }
                                    } catch (e) {}
                                },
                                destroy: () => {
                                    proj.alive = false;
                                    try { this.scene.remove(proj.mesh); } catch (e) {}
                                }
                            };
                            this.enemies.push(proj);
                        } catch (err) { console.warn('spawnFlame failed', err); }
                    },
                    update: (targetPos, dt) => {
                        if (!boss.alive) return;
                        try {
                            const prefer = (this.world && this.world.builderG) ? this.world.builderG.position : this.player.mesh.position;
                            const dir = new THREE.Vector3().subVectors(prefer, boss.mesh.position);
                            dir.y = 0;
                            const dist = dir.length();
                            if (dist > 6) {
                                dir.normalize();
                                boss.mesh.position.add(dir.multiplyScalar(1.8 * dt));
                            } else {
                                boss.mesh.position.y = 4.8 + Math.sin(Date.now() * 0.0018) * 0.35;
                                boss.mesh.rotation.y += 0.4 * dt;
                            }

                            boss.fireTimer -= dt;
                            if (boss.fireTimer <= 0) {
                                boss.fireTimer = boss.fireCooldown + Math.random() * 0.6;
                                const target = (this.world && this.world.builderG) ? this.world.builderG.position.clone() : this.player.mesh.position.clone();
                                const start = boss.mesh.position.clone().add(new THREE.Vector3((Math.random()-0.5)*1.4, -0.6, (Math.random()-0.5)*1.4));
                                const count = 2 + Math.floor(Math.random()*2);
                                for (let i=0;i<count;i++) {
                                    this.spawnFlame(start.clone(), target.clone());
                                }
                                if (this.alertsEnabled) this.playSound('bomb');
                            }
                        } catch (err) {}
                    },
                    takeDamage: () => {
                        boss.hp -= 22;
                        if (boss.hp <= 0) { boss.alive = false; try { this.scene.remove(boss.mesh); } catch(e) {} }
                        try {
                            boss.mesh.material.color.lerp(new THREE.Color(0xffffff), 0.2);
                            setTimeout(()=>{ try{ boss.mesh.material.color.lerp(new THREE.Color(0xffffff), -0.2);}catch(e){} }, 180);
                        } catch(e){}
                    },
                    destroy: () => {
                        boss.alive = false;
                        try { this.scene.remove(boss.mesh); } catch(e){}
                    }
                };

                this._tanBoss = boss;
                this.enemies.push(boss);

                if (this._announcementText) {
                    this._announcementText.textContent = 'BOSS FIGHT — Tan The Orange has arrived! Protect Builder G!';
                    setTimeout(()=>{ try{ this._announcementText.textContent = 'UPDATES MORE SOON!'; }catch(e){} }, 3000);
                }
                this.gameState.isSurvival = true;
                this.scene.background = new THREE.Color(0x2a0f00);
                this.scene.fog = new THREE.FogExp2(0x2a0f00, 0.06);
                if (this.alertsEnabled) this.playSound('day');

            } catch (innerErr) {
                console.warn('Failed inside Tan texture callback', innerErr);
            }
        }, undefined, (err) => {
            console.warn('Failed to load Tan texture:', path, err);
            // Fallback: spawn a simple colored sprite so boss still appears
            try {
                const mat = new THREE.SpriteMaterial({ color: 0xff8a33 });
                const sprite = new THREE.Sprite(mat);
                sprite.scale.set(4.0, 4.0, 1);
                sprite.position.set(p.x + 10, 4.8, p.z + 6);
                this.scene.add(sprite);
                const fallbackBoss = { name: 'Tan (fallback)', alive: true, mesh: sprite, hp: 190, update: () => {}, destroy: () => { try{ this.scene.remove(sprite); }catch(e){} } };
                this._tanBoss = fallbackBoss;
                this.enemies.push(fallbackBoss);
                if (this._announcementText) {
                    this._announcementText.textContent = 'BOSS FIGHT — Tan (fallback) spawned (texture load failed).';
                    setTimeout(()=>{ try{ this._announcementText.textContent='UPDATES MORE SOON!'; }catch(e){} },2000);
                }
            } catch (fbErr) { console.warn('Fallback Tan spawn failed', fbErr); }
        });

    } catch (e) { console.warn('spawnTanBoss failed', e); }
};

/* Boss 5: Ishoweyes — undefeatable, kills pets/players, corrupts saves and forces a bad ending */
Game.prototype.spawnIshoweyesBoss = function () {
    try {
        // if already present, reposition and re-activate
        if (this._ishBoss && this._ishBoss.alive) {
            try { this._ishBoss.mesh.position.copy(this.player.mesh.position).add(new THREE.Vector3(0, 6, -6)); this._ishBoss.alive = true; } catch(e){}
            return;
        }

        // Create the Ishoweyes sprite (asset is present in project)
        const tex = new THREE.TextureLoader().load('/ishoweyes.jpeg');
        const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
        const sprite = new THREE.Sprite(mat);
        sprite.scale.set(8, 8, 1);
        sprite.position.copy(this.player.mesh.position).add(new THREE.Vector3(0, 6, -6));
        sprite.name = 'Ishoweyes';
        this.scene.add(sprite);

        const boss = {
            name: 'Ishoweyes',
            alive: true,
            mesh: sprite,
            // Make Ishoweyes effectively invulnerable
            immune: true,
            hp: Infinity,
            // internal timer to periodically kill pets / corrupt data
            strikeTimer: 1.4,
            strikeInterval: 1.4,
            update: (tp, dt) => {
                if (!boss.alive) return;
                try {
                    // slowly hover and stare at player
                    boss.mesh.position.y = 5.6 + Math.sin(Date.now() * 0.0012) * 0.4;
                    // rotate to face player for creepy effect
                    const dir = new THREE.Vector3().subVectors(this.player.mesh.position, boss.mesh.position);
                    dir.y = 0;
                    if (dir.length() > 0.01) {
                        const yaw = Math.atan2(dir.x, dir.z);
                        boss.mesh.rotation.y = yaw;
                    }
                    boss.strikeTimer -= dt;
                    if (boss.strikeTimer <= 0) {
                        boss.strikeTimer = boss.strikeInterval + Math.random() * 0.6;

                        // Kill pets: remove pet sprites if present (Cashy, BuilderG, Banana, Baby Capybara, DancingBanana, Chromebook, frogs)
                        try {
                            const petKeys = ['cashy','builderG','dancingBanana','babyCapybara','chromebook'];
                            petKeys.forEach(k => {
                                try {
                                    if (this.world && this.world[k]) {
                                        try { this.scene.remove(this.world[k]); } catch(e){}
                                        this.world[k] = null;
                                    }
                                } catch (e) {}
                            });
                            // frogs array: remove and kill
                            if (this.world && Array.isArray(this.world.frogs)) {
                                this.world.frogs.forEach(f => { try { this.scene.remove(f); } catch(e){} });
                                this.world.frogs = [];
                            }
                        } catch (e) {}

                        // Also immediately damage player heavily (instant death feel)
                        try {
                            this.player.hp = (this.player.hp === undefined) ? 0 : this.player.hp;
                            this.player.hp -= 9999;
                            if (this.player.hp <= 0) {
                                this.gameState.gameOver = true;
                                try { document.getElementById('instructions').innerHTML = "BAD ENDING — The eyes consumed everything. Data corrupted."; } catch(e){}

                                // Create or reuse a full-screen black overlay that will rotate the view
                                try {
                                    let ishOverlay = document.getElementById('ish-overlay');
                                    if (!ishOverlay) {
                                        ishOverlay = document.createElement('div');
                                        ishOverlay.id = 'ish-overlay';
                                        ishOverlay.style.position = 'fixed';
                                        ishOverlay.style.inset = '0';
                                        ishOverlay.style.zIndex = '100000';
                                        ishOverlay.style.background = '#000';
                                        ishOverlay.style.color = '#fff';
                                        ishOverlay.style.display = 'flex';
                                        ishOverlay.style.alignItems = 'center';
                                        ishOverlay.style.justifyContent = 'center';
                                        ishOverlay.style.fontFamily = 'Segoe UI, Tahoma, sans-serif';
                                        ishOverlay.style.fontSize = '22px';
                                        ishOverlay.style.textAlign = 'center';
                                        ishOverlay.style.pointerEvents = 'none';
                                        ishOverlay.style.transition = 'transform 0.05s linear';
                                        ishOverlay.innerHTML = '<div style="max-width:90%;line-height:1.4;">BAD ENDING — The eyes consumed everything.<br><span id="ish-tts-status" style="display:block;margin-top:12px;font-size:14px;color:#ccc;">Ishoweyes...</span></div>';
                                        document.body.appendChild(ishOverlay);
                                    } else {
                                        ishOverlay.style.display = 'flex';
                                    }

                                    // Gentle continuous rotation effect (incremental, not jarring)
                                    if (!window._ishOverlayRot) {
                                        window._ishOverlayRot = { deg: 0, timer: null };
                                        window._ishOverlayRot.timer = setInterval(() => {
                                            try {
                                                window._ishOverlayRot.deg = (window._ishOverlayRot.deg + 0.35) % 360;
                                                ishOverlay.style.transform = `rotate(${window._ishOverlayRot.deg}deg)`;
                                            } catch (e) {}
                                        }, 16); // ~60fps-ish smooth rotation
                                    }

                                    // Mute other game audio for finality
                                    try { this.soundsMuted = true; this.stopJelly(); } catch(e){}

                                    // Start an infinite TTS loop that repeatedly says "Ishoweyes" (use Websim TTS if available)
                                    const startIshTTS = async () => {
                                        try {
                                            // prefer websim.textToSpeech if available
                                            if (window.websim && typeof window.websim.textToSpeech === 'function') {
                                                // create a short audio element and loop it by replaying on end
                                                const speak = async () => {
                                                    try {
                                                        const res = await websim.textToSpeech({ text: "Ishoweyes", voice: 'en-male' });
                                                        if (res && res.url) {
                                                            const a = new Audio(res.url);
                                                            a.volume = 1.0;
                                                            a.play().catch(()=>{});
                                                            a.onended = () => { if (!this.gameState || !this.gameState.gameOver) return; speak(); };
                                                            // keep reference so GC doesn't unload
                                                            window._ishAudio = a;
                                                            return;
                                                        }
                                                    } catch (e) {}
                                                    // fallback below if websim failed
                                                    try { fallbackSpeak(); } catch(e){}
                                                };
                                                speak();
                                                return;
                                            }
                                        } catch (e) {}

                                        // fallback to browser speechSynthesis with onend restart
                                        const fallbackSpeak = () => {
                                            try {
                                                if (!window.speechSynthesis) return;
                                                const utter = new SpeechSynthesisUtterance("Ishoweyes");
                                                utter.rate = 0.95;
                                                utter.pitch = 0.9;
                                                utter.volume = 1.0;
                                                utter.onend = () => {
                                                    // only continue if still in game over/bad ending
                                                    if (this.gameState && this.gameState.gameOver) {
                                                        // small delay to avoid tight loop
                                                        setTimeout(() => { try { fallbackSpeak(); } catch(e){} }, 120);
                                                    }
                                                };
                                                window.speechSynthesis.cancel();
                                                window.speechSynthesis.speak(utter);
                                            } catch (e) {}
                                        };

                                        // Try browser TTS immediately if websim unavailable
                                        fallbackSpeak();
                                    };

                                    // Only start once
                                    if (!window._ishTTSStarted) {
                                        window._ishTTSStarted = true;
                                        try { startIshTTS(); } catch (e) {}
                                    }

                                } catch (overlayErr) {
                                    console.warn('Failed to show Ishoweyes overlay', overlayErr);
                                }
                            }
                        } catch (e) {}

                        // Visual glitch: rapidly toggle scene background and fog to black and back
                        try {
                            const orig = this.scene.background ? this.scene.background.clone() : new THREE.Color(0x87CEEB);
                            const origFog = this.scene.fog ? (this.scene.fog.color ? this.scene.fog.color.clone() : null) : null;
                            this.scene.background = new THREE.Color(0x000000);
                            this.scene.fog = new THREE.FogExp2(0x000000, 0.12);
                            setTimeout(() => {
                                try {
                                    if (this.scene) {
                                        this.scene.background = orig;
                                        if (origFog) this.scene.fog = new THREE.FogExp2(origFog.getHex(), 0.02);
                                    }
                                } catch (e) {}
                            }, 600);
                        } catch (e) {}

                        // Corrupt local save / quicksave with "GLITCHED" payload to simulate data glitch
                        try {
                            const corrupt = { badEnding: true, note: 'ISHOWEYES_CONSUMED', timestamp: Date.now(), corrupted: true };
                            try { localStorage.setItem('capybara_quicksave', JSON.stringify(corrupt)); } catch (e) {}
                            try { localStorage.setItem('capybara_campaign_save', JSON.stringify(corrupt)); } catch (e) {}
                        } catch (e) {}

                        // Announcement and forced bad ending UI
                        if (this._announcementText) {
                            this._announcementText.textContent = "Ishoweyes: There is no escape... DATA CORRUPTED.";
                            setTimeout(()=>{ try{ this._announcementText.textContent='UPDATES MORE SOON!'; }catch(e){} }, 4000);
                        }

                        // Stop music and sounds to emphasize finality
                        try { this.stopJelly(); } catch(e){}
                        this.soundsMuted = true;
                    }
                } catch (e) {}
            },
            takeDamage: () => {
                // immune: give feedback but do not die
                if (this._announcementText) {
                    this._announcementText.textContent = "Ishoweyes is immune to harm!";
                    setTimeout(()=>{ try{ this._announcementText.textContent='UPDATES MORE SOON!'; }catch(e){} }, 1800);
                }
            },
            destroy: () => {
                boss.alive = false;
                try { this.scene.remove(boss.mesh); } catch(e){}
            }
        };

        this._ishBoss = boss;
        this.enemies.push(boss);

        // On spawn: immediately summon major bosses and big enemy waves
        try {
            // spawn James boss
            if (typeof this.spawnJamesBoss === 'function') {
                try { this.spawnJamesBoss(); } catch(e){ console.warn('spawnJamesBoss during ishoweyes failed', e); }
            }
            // spawn Tan boss
            if (typeof this.spawnTanBoss === 'function') {
                try { this.spawnTanBoss(); } catch(e){ console.warn('spawnTanBoss during ishoweyes failed', e); }
            }
            // spawn castle siege (Infector King) with a large count
            if (typeof this.spawnCastleInfectors === 'function') {
                try { this.spawnCastleInfectors(36); } catch(e){ console.warn('spawnCastleInfectors during ishoweyes failed', e); }
            }
            // spawn a shark army near player
            try { if (typeof this.spawnSharkArmy === 'function') this.spawnSharkArmy(10); } catch(e){ console.warn('spawnSharkArmy during ishoweyes failed', e); }

            // Also spawn many standard enemies around player for immediate pressure
            for (let i = 0; i < 36; i++) {
                try {
                    const angle = Math.random() * Math.PI * 2;
                    const r = 6 + Math.random() * 28;
                    const spawnPos = new THREE.Vector3(this.player.mesh.position.x + Math.cos(angle) * r, 0, this.player.mesh.position.z + Math.sin(angle) * r);
                    this.enemies.push(new Enemy(this.scene, spawnPos));
                } catch (e) {}
            }
        } catch (e) {
            console.warn('Failed to spawn allied bosses/enemies for ishoweyes', e);
        }

        // Immediately produce a bad-ending sequence after a short delay to let the boss "arrive"
        setTimeout(() => {
            try {
                // set dramatic visuals
                this.scene.background = new THREE.Color(0x000000);
                this.scene.fog = new THREE.FogExp2(0x000000, 0.12);
                // force game over
                this.gameState.gameOver = true;
                const instr = document.getElementById('instructions');
                if (instr) instr.innerHTML = "BAD ENDING — The eyes have glitched the world and your save.";
                // corrupt more persistent storage
                try { localStorage.setItem('capybara_final_bad_end', JSON.stringify({ by: 'Ishoweyes', when: Date.now() })); } catch(e){}
            } catch (e) {}
        }, 1400);

        if (this._announcementText) {
            this._announcementText.textContent = 'An unstoppable presence arrives... Ishoweyes.';
            setTimeout(()=>{ try{ this._announcementText.textContent='UPDATES MORE SOON!'; }catch(e){} }, 2200);
        }

        // Play the dedicated Ishoweyes boss music (attempt before muting audio for finality)
        try { this.playSound('ishoweyes'); } catch(e) { /* ignore if sound missing */ }

        // survival lock and audio mute for finality
        this.gameState.isSurvival = true;
        this.soundsMuted = true;
    } catch (e) {
        console.warn('spawnIshoweyesBoss failed', e);
    }
};

/* Boss 7: The Ruined Ones — draws scribbles and forces a player choice; choosing Yes triggers a destructive scribble effect, choosing No summons Ishoweyes + allied bosses/enemies */
Game.prototype.spawnRuinedOnes = function () {
    try {
        // prevent repeated spawns
        if (this._ruinedOnes && this._ruinedOnes.alive) {
            try { this._ruinedOnes.mesh.position.copy(this.player.mesh.position).add(new THREE.Vector3(0,5,-6)); this._ruinedOnes.alive = true; } catch(e){}
            return;
        }

        // Create Ruined Ones sprite (use the requested Ruined Ones image asset)
        const tex = new THREE.TextureLoader().load('/The ruined ones.png');
        const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
        const sprite = new THREE.Sprite(mat);
        sprite.scale.set(7, 7, 1);
        sprite.position.copy(this.player.mesh.position).add(new THREE.Vector3(0, 5, -6));
        sprite.name = 'The Ruined Ones';
        this.scene.add(sprite);

        const boss = {
            name: 'The Ruined Ones',
            alive: true,
            mesh: sprite,
            hp: Infinity,
            // when spawned, prompt the player with a dialog that simulates "draw a scribble"
            promptAndResolve: () => {
                try {
                    // create dialog
                    let dlg = document.getElementById('ruined-dialog');
                    if (!dlg) {
                        dlg = document.createElement('div');
                        dlg.id = 'ruined-dialog';
                        dlg.style.position = 'fixed';
                        dlg.style.left = '50%';
                        dlg.style.top = '20%';
                        dlg.style.transform = 'translateX(-50%)';
                        dlg.style.zIndex = '10005';
                        dlg.style.background = 'rgba(0,0,0,0.9)';
                        dlg.style.color = '#fff';
                        dlg.style.padding = '14px';
                        dlg.style.borderRadius = '10px';
                        dlg.style.boxShadow = '0 12px 40px rgba(0,0,0,0.6)';
                        dlg.style.maxWidth = '420px';
                        dlg.innerHTML = `
                            <div style="font-weight:800;margin-bottom:8px;">The Ruined Ones</div>
                            <div style="font-size:14px;color:#ddd;margin-bottom:12px;">It begins to draw chaotic scribbles in the air... Time to drawing — draw a scribble?</div>
                            <div style="display:flex;gap:8px;justify-content:center;">
                                <button id="ruined-yes" style="padding:8px 12px;border-radius:8px;border:0;background:#d32f2f;color:white;cursor:pointer;">Yes</button>
                                <button id="ruined-no" style="padding:8px 12px;border-radius:8px;border:0;background:#4CAF50;color:white;cursor:pointer;">No</button>
                            </div>
                        `;
                        document.body.appendChild(dlg);
                    } else {
                        dlg.style.display = 'block';
                    }

                    // Yes: immediate corruptive effect — draw scribbles across the screen then heavily damage player and pets
                    document.getElementById('ruined-yes').onclick = () => {
                        try {
                            dlg.style.display = 'none';
                        } catch (e) {}
                        // create scribble canvas overlay that animates quick scribbles then removes
                        try {
                            let canvas = document.getElementById('ruined-canvas');
                            if (!canvas) {
                                canvas = document.createElement('canvas');
                                canvas.id = 'ruined-canvas';
                                canvas.style.position = 'fixed';
                                canvas.style.left = '0';
                                canvas.style.top = '0';
                                canvas.style.width = '100%';
                                canvas.style.height = '100%';
                                canvas.style.zIndex = '100006';
                                canvas.style.pointerEvents = 'none';
                                document.body.appendChild(canvas);
                                canvas.width = window.innerWidth;
                                canvas.height = window.innerHeight;
                            }
                            const ctx = canvas.getContext('2d');
                            ctx.clearRect(0,0,canvas.width,canvas.height);
                            ctx.strokeStyle = '#ffffff';
                            ctx.lineWidth = 4;
                            // draw many random scribbles quickly
                            for (let s = 0; s < 28; s++) {
                                ctx.beginPath();
                                const sx = Math.random() * canvas.width;
                                const sy = Math.random() * canvas.height;
                                ctx.moveTo(sx, sy);
                                for (let p = 0; p < 10; p++) {
                                    ctx.lineTo(sx + (Math.random() - 0.5) * 300, sy + (Math.random() - 0.5) * 200);
                                }
                                ctx.stroke();
                            }
                            // flash and then corrupt visuals
                            canvas.style.opacity = '0';
                            canvas.style.transition = 'opacity 0.12s ease-in';
                            setTimeout(()=>{ canvas.style.opacity = '1'; }, 20);
                            setTimeout(()=>{ canvas.style.opacity = '0'; }, 820);
                            setTimeout(()=>{ try { canvas.remove(); } catch(e){} }, 1200);
                        } catch (e) {}

                        // immediate destructive result: heavily damage player and remove pets
                        try {
                            // kill player
                            this.player.hp = 0;
                            this.gameState.gameOver = true;
                            const instr = document.getElementById('instructions');
                            if (instr) instr.innerHTML = "BAD ENDING — The scribbles consumed you and your Capybara is ruined.";
                            // remove pets
                            const petKeys = ['cashy','builderG','dancingBanana','babyCapybara','chromebook'];
                            petKeys.forEach(k => {
                                try { if (this.world && this.world[k]) { this.scene.remove(this.world[k]); this.world[k] = null; } } catch(e){}
                            });
                            if (this.alertsEnabled) this.playSound('day');
                        } catch (e) {}

                        // corrupt quicksave as consequence
                        try { localStorage.setItem('capybara_quicksave', JSON.stringify({ ruined: true, when: Date.now() })); } catch (e) {}
                    };

                    // No: the Ruined Ones summons Ishoweyes and allied bosses/enemies as a punishment
                    document.getElementById('ruined-no').onclick = () => {
                        try { dlg.style.display = 'none'; } catch (e) {}
                        try {
                            // spawn Ishoweyes and allied hordes
                            if (typeof this.spawnIshoweyesBoss === 'function') this.spawnIshoweyesBoss();
                            if (typeof this.spawnCastleInfectors === 'function') this.spawnCastleInfectors(28);
                            if (typeof this.spawnJamesBoss === 'function') this.spawnJamesBoss();
                            if (typeof this.spawnTanBoss === 'function') this.spawnTanBoss();
                            // spawn extra enemies for immediate pressure
                            const p = this.player.mesh.position.clone();
                            for (let i = 0; i < 20; i++) {
                                const angle = Math.random() * Math.PI * 2;
                                const r = 6 + Math.random() * 28;
                                const spawnPos = new THREE.Vector3(p.x + Math.cos(angle) * r, 0, p.z + Math.sin(angle) * r);
                                this.enemies.push(new Enemy(this.scene, spawnPos));
                            }
                        } catch (e) { console.warn('Ruined Ones punishment spawn failed', e); }
                        if (this._announcementText) {
                            this._announcementText.textContent = 'You refused the scribble... The Ruined Ones summoned horrors!';
                            setTimeout(()=>{ try{ this._announcementText.textContent='UPDATES MORE SOON!'; }catch(e){} }, 2800);
                        }
                    };
                } catch (e) { console.warn('Ruined prompt failed', e); }
            }
        };

        // assign boss object
        this._ruinedOnes = boss;
        this.enemies.push(boss);

        // announce and set survival mode
        if (this._announcementText) {
            this._announcementText.textContent = 'THE RUINED ONES — A corrupt artist emerges...';
            setTimeout(()=>{ try{ this._announcementText.textContent='UPDATES MORE SOON!'; }catch(e){} }, 2200);
        }
        this.gameState.isSurvival = true;

        // show the prompt to the player after a short delay so the boss "draws"
        setTimeout(() => {
            try { boss.promptAndResolve(); } catch (e) { console.warn('Failed to show ruined prompt', e); }
        }, 700);
    } catch (e) {
        console.warn('spawnRuinedOnes failed', e);
    }
};

Game.prototype.openBossSelector = function () {
    try {
        let dlg = document.getElementById('boss-selector-dialog');
        if (!dlg) {
            dlg = document.createElement('div');
            dlg.id = 'boss-selector-dialog';
            dlg.style.position = 'fixed';
            dlg.style.left = '50%';
            dlg.style.top = '18%';
            dlg.style.transform = 'translateX(-50%)';
            dlg.style.zIndex = '10004';
            dlg.style.background = 'rgba(255,255,255,0.98)';
            dlg.style.padding = '12px';
            dlg.style.borderRadius = '10px';
            dlg.style.boxShadow = '0 12px 40px rgba(0,0,0,0.4)';
            dlg.style.maxWidth = '420px';
            dlg.innerHTML = `
                <div style="font-weight:800;margin-bottom:8px;">Boss Fights</div>
                <div style="font-size:13px;color:#222;margin-bottom:8px;">Choose a boss to start the fight:</div>
                <div style="display:flex;flex-direction:column;gap:8px;">
                    <button id="bf-james" style="padding:8px;border-radius:8px;border:0;background:#7B1FA2;color:white;cursor:pointer;">1) James — Aggressive human boss</button>
                    <button id="bf-mouthy" style="padding:8px;border-radius:8px;border:0;background:#D32F2F;color:white;cursor:pointer;">2) The Mouthy — Fireball boss</button>
                    <button id="bf-infector-king" style="padding:8px;border-radius:8px;border:0;background:#455A64;color:white;cursor:pointer;">3) Infector King — King Infectors siege</button>
                    <button id="bf-tan" style="padding:8px;border-radius:8px;border:0;background:#FF8A00;color:#111;cursor:pointer;">4) Tan The Orange — Flaming enforcer</button>
                    <button id="bf-ish" style="padding:8px;border-radius:8px;border:0;background:#000;color:#fff;cursor:pointer;">5) Ishoweyes — Unstoppable Glitch</button>
                    <button id="bf-ruined" style="padding:8px;border-radius:8px;border:0;background:#3E2723;color:#fff;cursor:pointer;">6) The Ruined Ones — Corruptive Artist</button>
                    <button id="bf-spiderking" style="padding:8px;border-radius:8px;border:0;background:#2E7D32;color:white;cursor:pointer;">7) Spider King — Mob leader with heavy attacks</button>
                    <button id="bf-evilcapy" style="padding:8px;border-radius:8px;border:0;background:#4A148C;color:#fff;cursor:pointer;">9) Evil Capybara — Glitch AI (F to throw objects)</button>
                    <button id="bf-redman" style="padding:8px;border-radius:8px;border:0;background:#B71C1C;color:#fff;cursor:pointer;">8) Redman — Nightmare surprise (press 7 to close eye, click to slap)</button>
                    <button id="bf-eaterer" style="padding:8px;border-radius:8px;border:0;background:#C62828;color:#fff;cursor:pointer;">The Eaterer — Throw Pets / First-Person (credits: BagelMaster5000)</button>
                </div>
                <div style="display:flex;justify-content:flex-end;margin-top:10px;"><button id="bf-close" style="padding:6px 8px;border-radius:8px;border:0;background:#bdbdbd;color:#111;">Close</button></div>
            `;
            document.body.appendChild(dlg);

            // Add Cursed Face button dynamically so it's available in the selector without modifying the large innerHTML block
            try {
                const cursedBtn = document.createElement('button');
                cursedBtn.id = 'bf-cursed';
                cursedBtn.style.padding = '8px';
                cursedBtn.style.borderRadius = '8px';
                cursedBtn.style.border = '0';
                cursedBtn.style.background = '#B71C1C';
                cursedBtn.style.color = 'white';
                cursedBtn.style.cursor = 'pointer';
                cursedBtn.style.marginTop = '8px';
                cursedBtn.textContent = 'Cursed Face — The Eaterer (replacement)';
                // Add it to the dialog (put near the bottom)
                dlg.appendChild(cursedBtn);
                // Wire up click to spawn The Eaterer instead of Cursed Face
                cursedBtn.addEventListener('click', () => {
                    try {
                        dlg.style.display = 'none';
                        if (typeof this.spawnEatererBoss === 'function') {
                            this.spawnEatererBoss();
                        } else if (window.game && typeof window.game.spawnEatererBoss === 'function') {
                            window.game.spawnEatererBoss();
                        } else {
                            alert('The Eaterer spawn not available.');
                        }
                    } catch (e) { console.warn('Failed to spawn The Eaterer', e); }
                });
            } catch (e) {
                console.warn('Failed to add replacement Eaterer button to boss selector', e);
            }

            document.getElementById('bf-close').onclick = () => { try { dlg.style.display = 'none'; } catch(e){} };
            document.getElementById('bf-james').onclick = () => {
                try { dlg.style.display = 'none'; this.spawnJamesBoss(); } catch(e){ console.warn(e); }
            };
            document.getElementById('bf-mouthy').onclick = () => {
                try { dlg.style.display = 'none';
                    // spawn The Mouthy using existing cursed logic if present else duplicate the earlier mouthy spawn
                    if (this._mouthyBoss && this._mouthyBoss.alive) {
                        // already exists: reposition near player
                        this._mouthyBoss.mesh.position.copy(this.player.mesh.position).add(new THREE.Vector3(0,6,-3));
                        this._mouthyBoss.alive = true;
                        if (this._announcementText) { this._announcementText.textContent = 'The Mouthy returns!'; setTimeout(()=>{ this._announcementText.textContent = 'UPDATES MORE SOON!'; },2000); }
                    } else {
                        // reuse cursed spawn creation (create similar mouthy structure)
                        // create The Mouthy as in original code block (simplified)
                        try {
                            const tex = new THREE.TextureLoader().load('/The Mouthy.png');
                            const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
                            const sprite = new THREE.Sprite(mat);
                            sprite.scale.set(6,6,1);
                            sprite.position.copy(this.player.mesh.position).add(new THREE.Vector3(0,6,-6));
                            sprite.userData.hp = 400;
                            this.scene.add(sprite);
                            const boss = {
                                name: 'The Mouthy',
                                alive: true,
                                mesh: sprite,
                                fireCooldown: 1.6,
                                fireTimer: 0.6,
                                update: (tp, dt) => {
                                    if (!boss.alive) return;
                                    boss.mesh.position.y = 5.8 + Math.sin(Date.now()*0.0015)*0.4;
                                    try {
                                        const dir = new THREE.Vector3().subVectors(this.player.mesh.position, boss.mesh.position); dir.y = 0;
                                        if (dir.length()>0.01) {
                                            const yaw = Math.atan2(dir.x, dir.z);
                                            boss.mesh.rotation.y = yaw;
                                        }
                                    } catch(e){}
                                    boss.fireTimer -= dt;
                                    if (boss.fireTimer <= 0) {
                                        boss.fireTimer = boss.fireCooldown + Math.random()*0.6;
                                        // spawn 3 fireballs toward player
                                        for (let i=0;i<3;i++){
                                            const fMat = new THREE.MeshStandardMaterial({ color:0x9b59ff, emissive:0x7d3cff, emissiveIntensity:1.2 });
                                            const fGeo = new THREE.SphereGeometry(0.28,8,8);
                                            const ball = new THREE.Mesh(fGeo,fMat);
                                            const start = boss.mesh.position.clone().add(new THREE.Vector3((Math.random()-0.5)*1.2, -0.6, (Math.random()-0.5)*1.2));
                                            ball.position.copy(start);
                                            ball.userData.dir = new THREE.Vector3().subVectors(this.player.mesh.position.clone().add(new THREE.Vector3(0,0.9,0)), start).normalize();
                                            ball.userData.speed = 10 + Math.random()*3;
                                            this.scene.add(ball);
                                            const proj = {
                                                alive:true,
                                                mesh:ball,
                                                update:(targ, dtdt)=>{
                                                    if(!proj.alive) return;
                                                    proj.mesh.position.add(proj.mesh.userData.dir.clone().multiplyScalar(proj.mesh.userData.speed * dtdt));
                                                    if (proj.mesh.position.distanceTo(this.player.mesh.position) < 1.1) {
                                                        this.player.hp = (this.player.hp===undefined)?100:this.player.hp;
                                                        this.player.hp -= 40;
                                                        proj.alive=false;
                                                        try{ this.scene.remove(proj.mesh); }catch(e){}
                                                        if (this.player.hp<=0) { this.gameState.gameOver=true; try{ document.getElementById('instructions').innerHTML='GAME OVER — The Mouthy killed you!'; }catch(e){} }
                                                    }
                                                },
                                                destroy: ()=>{ proj.alive=false; try{ this.scene.remove(proj.mesh);}catch(e){} }
                                            };
                                            this.enemies.push(proj);
                                        }
                                        if (this.alertsEnabled) this.playSound('bomb');
                                    }
                                },
                                destroy: () => { boss.alive=false; try{ this.scene.remove(boss.mesh); }catch(e){} }
                            };
                            this._mouthyBoss = boss;
                            this.enemies.push(boss);
                            if (this._announcementText) { this._announcementText.textContent = 'BOSS FIGHT — The Mouthy appears!'; setTimeout(()=>{ this._announcementText.textContent='UPDATES MORE SOON!';},2000); }
                        } catch (err) { console.warn('Failed to spawn Mouthy boss', err); }
                    }
                    // enter survival visuals
                    this.gameState.isSurvival = true;
                    this.scene.background = new THREE.Color(0x071a12);
                    this.scene.fog = new THREE.FogExp2(0x071a12, 0.08);
                } catch(e){ console.warn(e); }
            };
            document.getElementById('bf-infector-king').onclick = () => {
                try {
                    dlg.style.display = 'none';
                    // reuse spawnCastleInfectors for Infector King (ensure big army)
                    if (typeof this.spawnCastleInfectors === 'function') {
                        this.spawnCastleInfectors(36);
                        if (this._announcementText) { this._announcementText.textContent = 'BOSS FIGHT — Infector King siege started!'; setTimeout(()=>{ this._announcementText.textContent='UPDATES MORE SOON!';},2000); }
                    } else {
                        // fallback: spawn many standard enemies
                        const p = this.player.mesh.position.clone();
                        for (let i=0;i<36;i++){
                            const angle = Math.random()*Math.PI*2;
                            const r = 8 + Math.random()*22;
                            const spawnPos = new THREE.Vector3(p.x + Math.cos(angle)*r, 0, p.z + Math.sin(angle)*r);
                            this.enemies.push(new Enemy(this.scene, spawnPos));
                        }
                        if (this._announcementText) { this._announcementText.textContent = 'Infector King fallback wave spawned.'; setTimeout(()=>{ this._announcementText.textContent='UPDATES MORE SOON!';},2000); }
                    }
                    // survival state & visual
                    this.gameState.isSurvival = true;
                    this.scene.background = new THREE.Color(0x2b2f3a);
                    this.scene.fog = new THREE.FogExp2(0x2b2f3a, 0.04);
                } catch(e){ console.warn(e); }
            };

            

            // Tan The Orange handler (fourth boss)
            document.getElementById('bf-tan').onclick = () => {
                try {
                    dlg.style.display = 'none';
                    if (typeof this.spawnTanBoss === 'function') {
                        this.spawnTanBoss();
                    } else {
                        // fallback: spawn a strong flaming sprite near player
                        const p = this.player.mesh.position.clone();
                        const spawnPos = new THREE.Vector3(p.x + 8, 4.5, p.z + 4);
                        const en = new Enemy(this.scene, spawnPos);
                        en.isBoss = true;
                        en.hp = 190;
                        en.takeDamage = () => { en.hp -= 22; if (en.hp <= 0) en.destroy(); };
                        this.enemies.push(en);
                        if (this._announcementText) { this._announcementText.textContent = 'Tan fallback spawned (weaker).'; setTimeout(()=>{ this._announcementText.textContent='UPDATES MORE SOON!';},2000); }
                    }
                } catch (e) { console.warn(e); }
            };

            // Ishoweyes button handler (boss 5)
            document.getElementById('bf-ish').onclick = () => {
                try {
                    dlg.style.display = 'none';
                    if (typeof this.spawnIshoweyesBoss === 'function') {
                        this.spawnIshoweyesBoss();
                    } else {
                        // fallback: desync and bad ending
                        try {
                            localStorage.setItem('capybara_quicksave', JSON.stringify({ corrupted: true, reason: 'fallback_ish' }));
                        } catch (e) {}
                        this.gameState.gameOver = true;
                        const instr = document.getElementById('instructions');
                        if (instr) instr.innerHTML = "BAD ENDING — Something indescribable has corrupted your save.";
                        if (this._announcementText) { this._announcementText.textContent = 'Ishoweyes (fallback): Data glitched.'; setTimeout(()=>{ this._announcementText.textContent='UPDATES MORE SOON!';},2000); }
                    }
                } catch (e) { console.warn(e); }
            };

        } else {
            dlg.style.display = 'flex';
        }
    } catch (e) {
        console.warn('openBossSelector failed', e);
    }
};

/*
Wire up Boss Fights button and add a Mod Menu (open with key '8') that exposes quick mod actions:
- spawn bosses, enemies, pets, objects
- teleport maps & change game modes
- kill all enemies/bosses
- toggle first-person & flying modes
- set IShowEyes speed
- trigger file/spawn helpers that already exist in Game
*/
window.addEventListener('load', () => {
    try {
        const btn = document.getElementById('bossfight-btn');
        if (btn) btn.addEventListener('click', () => {
            if (window.game) window.game.openBossSelector();
        });
    } catch (e) {}

    // Mod menu builder
    Game.prototype.openModMenu = function () {
        try {
            let dlg = document.getElementById('mod-menu-dialog');
            if (!dlg) {
                dlg = document.createElement('div');
                dlg.id = 'mod-menu-dialog';
                dlg.style.position = 'fixed';
                dlg.style.left = '50%';
                dlg.style.top = '10%';
                dlg.style.transform = 'translateX(-50%)';
                dlg.style.zIndex = '10006';
                dlg.style.background = 'rgba(18,18,18,0.95)';
                dlg.style.color = '#fff';
                dlg.style.padding = '14px';
                dlg.style.borderRadius = '12px';
                dlg.style.boxShadow = '0 12px 40px rgba(0,0,0,0.6)';
                dlg.style.maxWidth = '520px';
                dlg.style.width = '92%';
                dlg.innerHTML = `
                    <div style="font-weight:900;font-size:16px;margin-bottom:8px;">MOD MENU</div>
                    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;">
                        <button id="mod-spawn-james" style="padding:8px;border-radius:8px;border:0;background:#7B1FA2;color:white;cursor:pointer;">Spawn James</button>
                        <button id="mod-spawn-tan" style="padding:8px;border-radius:8px;border:0;background:#FF8A00;color:#111;cursor:pointer;">Spawn Tan</button>
                        <button id="mod-spawn-ish" style="padding:8px;border-radius:8px;border:0;background:#000;color:#FFD54F;cursor:pointer;">Spawn IShowEyes</button>
                        <button id="mod-spawn-ruined" style="padding:8px;border-radius:8px;border:0;background:#3E2723;color:#fff;cursor:pointer;">Spawn Ruined Ones</button>
                        <button id="mod-spawn-infectors" style="padding:8px;border-radius:8px;border:0;background:#d32f2f;color:white;cursor:pointer;">Spawn Infectors Dede</button>
                        <button id="mod-spawn-poisonfrogs" style="padding:8px;border-radius:8px;border:0;background:#388E3C;color:white;cursor:pointer;">Spawn Poison Frogs</button>
                        <button id="mod-spawn-sharks" style="padding:8px;border-radius:8px;border:0;background:#0277BD;color:white;cursor:pointer;">Spawn Sharks</button>
                        <button id="mod-spawn-baby" style="padding:8px;border-radius:8px;border:0;background:#FFB74D;color:#111;cursor:pointer;">Spawn Baby Capybara</button>

                        <!-- New boss quick-spawn buttons -->
                        <button id="mod-spawn-redman" style="padding:8px;border-radius:8px;border:0;background:#B71C1C;color:white;cursor:pointer;">Spawn Redman</button>
                        <button id="mod-spawn-evilcapy" style="padding:8px;border-radius:8px;border:0;background:#4A148C;color:#fff;cursor:pointer;">Spawn Evil Capybara</button>
                        <button id="mod-spawn-spiderking" style="padding:8px;border-radius:8px;border:0;background:#2E7D32;color:white;cursor:pointer;">Spawn Spider King</button>

                        <button id="mod-teleport" style="padding:8px;border-radius:8px;border:0;background:#1976D2;color:white;cursor:pointer;">Teleport (prompt)</button>
                        <button id="mod-mode" style="padding:8px;border-radius:8px;border:0;background:#4CAF50;color:white;cursor:pointer;">Set Mode (prompt)</button>
                        <button id="mod-kill-all" style="padding:8px;border-radius:8px;border:0;background:#B71C1C;color:white;cursor:pointer;">Kill All Enemies</button>
                        <button id="mod-firstperson" style="padding:8px;border-radius:8px;border:0;background:#607D8B;color:white;cursor:pointer;">Toggle First Person</button>
                        <button id="mod-flying" style="padding:8px;border-radius:8px;border:0;background:#8E24AA;color:white;cursor:pointer;">Toggle Flying Mode</button>
                        <div style="grid-column:1 / -1;display:flex;gap:8px;">
                            <input id="mod-ish-speed" placeholder="IShowEyes speed (number)" style="flex:1;padding:8px;border-radius:8px;border:1px solid #444;background:#222;color:#fff;">
                            <button id="mod-set-ish-speed" style="padding:8px;border-radius:8px;border:0;background:#FF7043;color:#111;cursor:pointer;">Set Speed</button>
                        </div>
                        <button id="mod-spawn-files" style="grid-column:1 / -1;padding:8px;border-radius:8px;border:0;background:#455A64;color:white;cursor:pointer;">Spawn Game Files (build ZIP)</button>
                        <button id="mod-level-editor" style="grid-column:1 / -1;padding:8px;border-radius:8px;border:0;background:#3F51B5;color:white;cursor:pointer;">Level Editor (Opinion)</button>
                        <button id="mod-close" style="grid-column:1 / -1;padding:8px;border-radius:8px;border:0;background:#9E9E9E;color:#111;cursor:pointer;">Close</button>
                    </div>
                    <div id="mod-menu-status" style="margin-top:10px;font-size:13px;color:#ddd;"></div>
                `;
                document.body.appendChild(dlg);

                // button wiring
                const statusEl = dlg.querySelector('#mod-menu-status');
                const safeLog = (s) => { if (statusEl) statusEl.textContent = s; };

                dlg.querySelector('#mod-spawn-james').addEventListener('click', () => { try { this.spawnJamesBoss(); safeLog('Spawned James boss'); } catch(e){ safeLog('Spawn James failed'); } });
                dlg.querySelector('#mod-spawn-tan').addEventListener('click', () => { try { this.spawnTanBoss(); safeLog('Spawned Tan boss'); } catch(e){ safeLog('Spawn Tan failed'); } });
                dlg.querySelector('#mod-spawn-ish').addEventListener('click', () => { try { this.spawnIshoweyesBoss(); safeLog('Spawned IShowEyes'); } catch(e){ safeLog('Spawn IShowEyes failed'); } });
                dlg.querySelector('#mod-spawn-ruined').addEventListener('click', () => { try { this.spawnRuinedOnes(); safeLog('Spawned The Ruined Ones'); } catch(e){ safeLog('Spawn Ruined Ones failed'); } });
                dlg.querySelector('#mod-spawn-infectors').addEventListener('click', () => { try { window.spawnInfectorsDede ? window.spawnInfectorsDede() : safeLog('spawnInfectorsDede not available'); safeLog('Triggered Infectors Dede'); } catch(e){ safeLog('Spawn infectors failed'); } });
                dlg.querySelector('#mod-spawn-poisonfrogs').addEventListener('click', () => { try { this.world && this.world.spawnPoisonDartFrogs ? this.world.spawnPoisonDartFrogs(12,{aggressive:true}) : safeLog('spawnPoisonDartFrogs not ready'); safeLog('Poison Frogs spawned'); } catch(e){ safeLog('Poison spawn failed'); } });
                dlg.querySelector('#mod-spawn-sharks').addEventListener('click', () => { try { this.spawnSharkArmy ? this.spawnSharkArmy(8) : safeLog('spawnSharkArmy not available'); safeLog('Shark army spawned'); } catch(e){ safeLog('Shark spawn failed'); } });
                dlg.querySelector('#mod-spawn-baby').addEventListener('click', () => { try { window.dispatchEvent(new KeyboardEvent('keydown',{key:'b'})); safeLog('Baby capybara spawn triggered'); } catch(e){ safeLog('Baby spawn failed'); } });

                // New boss handlers
                dlg.querySelector('#mod-spawn-redman').addEventListener('click', () => {
                    try {
                        if (typeof this.spawnRedmanBoss === 'function') {
                            this.spawnRedmanBoss();
                            safeLog('Spawned Redman');
                        } else {
                            safeLog('spawnRedmanBoss not available');
                        }
                    } catch (e) { safeLog('Spawn Redman failed'); }
                });

                dlg.querySelector('#mod-spawn-evilcapy').addEventListener('click', () => {
                    try {
                        if (typeof this.spawnEvilCapybaraBoss === 'function') {
                            this.spawnEvilCapybaraBoss();
                            safeLog('Spawned Evil Capybara');
                        } else {
                            safeLog('spawnEvilCapybaraBoss not available');
                        }
                    } catch (e) { safeLog('Spawn Evil Capybara failed'); }
                });

                dlg.querySelector('#mod-spawn-spiderking').addEventListener('click', () => {
                    try {
                        // reuse existing P-key spawn behavior by dispatching 'p' to trigger same routine (spawns spider horde + king)
                        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p' }));
                        safeLog('Requested Spider horde & Spider King (P emulated)');
                    } catch (e) { safeLog('Spawn Spider King failed'); }
                });

                dlg.querySelector('#mod-teleport').addEventListener('click', () => {
                    try {
                        const dest = prompt('Teleport to (e.g. desert, snow, ishowmaps, island):', 'garden');
                        if (!dest) return;
                        window._teleportOverride = dest;
                        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'q' }));
                        safeLog('Teleport requested: ' + dest);
                    } catch (e) { safeLog('Teleport failed'); }
                });

                dlg.querySelector('#mod-mode').addEventListener('click', () => {
                    try {
                        const mode = prompt('Set game mode (normal, harder, fast-infectors, survive-bosses, insane-server):', 'normal');
                        if (!mode) return;
                        // reuse existing menu-mode handlers by setting queued mode or mutating game directly
                        try { window._queuedMode = mode; if (this._announcementText) this._announcementText.textContent = 'Queued mode: ' + mode; } catch(e){}
                        safeLog('Mode queued: ' + mode);
                    } catch (e) { safeLog('Mode change failed'); }
                });

                dlg.querySelector('#mod-kill-all').addEventListener('click', () => {
                    try {
                        let killed = 0;
                        this.enemies.forEach(en => { try { if (en && en.destroy) { en.destroy(); killed++; } else if (en && en.mesh) { this.scene.remove(en.mesh); killed++; } } catch(e){} });
                        // clear array
                        this.enemies = this.enemies.filter(en => en && en.alive);
                        safeLog('Killed ' + killed + ' enemies/bosses');
                        if (this._announcementText) this._announcementText.textContent = 'All enemies removed by Mod Menu';
                    } catch (e) { safeLog('Kill all failed'); }
                });

                // toggle first person
                dlg.querySelector('#mod-firstperson').addEventListener('click', () => {
                    try {
                        if (this.firstPerson) this.disableFirstPersonMode();
                        else this.enableFirstPersonMode();
                        safeLog('Toggled first-person: ' + (!!this.firstPerson));
                    } catch (e) { safeLog('First-person toggle failed'); }
                });

                // flying mode toggle: simple flag that makes player Y float in animate loop if set
                dlg.querySelector('#mod-flying').addEventListener('click', () => {
                    try {
                        this._flyingMode = !this._flyingMode;
                        safeLog('Flying mode: ' + (this._flyingMode ? 'ON' : 'OFF'));
                        if (this._flyingMode) {
                            if (this._announcementText) this._announcementText.textContent = 'Flying enabled (player will gently float)';
                        } else {
                            if (this._announcementText) this._announcementText.textContent = 'Flying disabled';
                        }
                    } catch (e) { safeLog('Flying toggle failed'); }
                });

                // set IShowEyes speed: adjust any existing _ishBoss update behaviour if present
                dlg.querySelector('#mod-set-ish-speed').addEventListener('click', () => {
                    try {
                        const v = Number(dlg.querySelector('#mod-ish-speed').value);
                        if (!isFinite(v) || v <= 0) { safeLog('Enter valid positive number'); return; }
                        if (this._ishBoss && this._ishBoss.alive) {
                            this._ishBoss._speedMultiplier = v;
                            // if update wrapper isn't present, add a small wrapper to nudge movement
                            if (typeof this._ishBoss._applySpeedWrapper === 'undefined') {
                                const originalUpdate = this._ishBoss.update.bind(this._ishBoss);
                                this._ishBoss.update = (tp, dt) => {
                                    try {
                                        // nudge toward player faster using multiplier when available
                                        const mult = this._ishBoss._speedMultiplier || 1.0;
                                        // try original update first
                                        originalUpdate(tp, dt);
                                        // then force small positional nudge toward player so speed change is noticeable
                                        try {
                                            const m = this._ishBoss.mesh;
                                            if (m && this.player && this.player.mesh) {
                                                const dir = new THREE.Vector3().subVectors(this.player.mesh.position, m.position);
                                                dir.y = 0;
                                                if (dir.length() > 0.05) {
                                                    dir.normalize();
                                                    m.position.add(dir.multiplyScalar( (5.0 * mult - 5.0) * dt )); // delta from base 5
                                                }
                                            }
                                        } catch(e){}
                                    } catch(e){}
                                };
                                this._ishBoss._applySpeedWrapper = true;
                            }
                            safeLog('Set IShowEyes speed multiplier to ' + v);
                        } else {
                            safeLog('IShowEyes not present');
                        }
                    } catch (e) { safeLog('Set speed failed'); }
                });

                // build spawn files (reuse F8 behavior by triggering the F8 key handler job if available)
                dlg.querySelector('#mod-spawn-files').addEventListener('click', () => {
                    try {
                        // simulate F8 to build patch zip (existing code listens for F8)
                        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F8' }));
                        safeLog('Requested build of patch ZIP (F8 emulated)');
                    } catch (e) { safeLog('Spawn files failed'); }
                });

                // Level Editor button: opens an opinionated level editor modal allowing placement overview and music import
                dlg.querySelector('#mod-level-editor').addEventListener('click', () => {
                    try {
                        // build modal if missing
                        let editor = document.getElementById('mod-level-editor-modal');
                        if (!editor) {
                            editor = document.createElement('div');
                            editor.id = 'mod-level-editor-modal';
                            editor.style.position = 'fixed';
                            editor.style.left = '50%';
                            editor.style.top = '8%';
                            editor.style.transform = 'translateX(-50%)';
                            editor.style.zIndex = '11000';
                            editor.style.background = 'rgba(255,255,255,0.98)';
                            editor.style.color = '#111';
                            editor.style.padding = '14px';
                            editor.style.borderRadius = '12px';
                            editor.style.boxShadow = '0 12px 40px rgba(0,0,0,0.4)';
                            editor.style.maxWidth = '760px';
                            editor.style.width = '92%';
                            editor.innerHTML = `
                                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                                  <div style="font-weight:900;font-size:16px;">Level Editor (Opinion)</div>
                                  <div style="font-size:12px;color:#666;">ESC to close • Save auto-stores to localStorage</div>
                                </div>
                                <div style="display:flex;gap:12px;">
                                  <div style="flex:1;min-width:240px;">
                                    <div style="font-weight:700;margin-bottom:6px;">Map Objects</div>
                                    <div id="le-objects" style="height:320px;overflow:auto;padding:8px;border:1px solid #eee;border-radius:8px;background:#fafafa;font-size:13px;"></div>
                                    <div style="display:flex;gap:8px;margin-top:8px;">
                                      <button id="le-refresh" style="flex:1;padding:8px;border-radius:8px;border:0;background:#1976D2;color:white;cursor:pointer;">Refresh List</button>
                                      <button id="le-save" style="flex:1;padding:8px;border-radius:8px;border:0;background:#4CAF50;color:white;cursor:pointer;">Save Level</button>
                                    </div>
                                  </div>
                                  <div style="flex:1;min-width:240px;">
                                    <div style="font-weight:700;margin-bottom:6px;">Import Music / Sound</div>
                                    <div style="display:flex;flex-direction:column;gap:8px;">
                                      <input id="le-music-url" placeholder="Paste YouTube / direct audio URL" style="width:100%;padding:8px;border-radius:8px;border:1px solid #ddd;font-size:13px;">
                                      <input id="le-music-file" type="file" accept="audio/*" style="font-size:13px;">
                                      <div style="display:flex;gap:8px;">
                                        <button id="le-import-url" style="flex:1;padding:8px;border-radius:8px;border:0;background:#3F51B5;color:white;cursor:pointer;">Import URL</button>
                                        <button id="le-import-file" style="flex:1;padding:8px;border-radius:8px;border:0;background:#8E24AA;color:white;cursor:pointer;">Upload File</button>
                                      </div>
                                      <div id="le-music-list" style="margin-top:8px;font-size:13px;color:#444;"></div>
                                    </div>
                                    <div style="margin-top:12px;">
                                      <div style="font-weight:700;margin-bottom:6px;">Preview</div>
                                      <audio id="le-audio-preview" controls style="width:100%;display:block;"></audio>
                                    </div>
                                  </div>
                                </div>
                                <div style="display:flex;justify-content:flex-end;margin-top:12px;">
                                  <button id="le-close" style="padding:8px 12px;border-radius:8px;border:0;background:#9E9E9E;color:#111;cursor:pointer;">Close (ESC)</button>
                                </div>
                            `;
                            document.body.appendChild(editor);

                            // fill objects list helper
                            const fillObjects = () => {
                                const container = document.getElementById('le-objects');
                                container.innerHTML = '';
                                try {
                                    const world = window.game && window.game.world;
                                    const player = window.game && window.game.player && window.game.player.mesh;
                                    const list = [];
                                    if (player) list.push({ type: 'player', name: 'Player', pos: player.position.clone() });
                                    if (world) {
                                        // pets & objects
                                        ['cashy','builderG','dancingBanana','parrot','babyCapybara','chromebook'].forEach(k => {
                                            try {
                                                const obj = world[k];
                                                if (!obj) return;
                                                list.push({ type: 'pet', key: k, name: obj.name || k, pos: obj.position.clone() });
                                            } catch (e) {}
                                        });
                                        // house and plant groups
                                        try { if (world.houseGroup) list.push({ type: 'house', name: 'HouseGroup', pos: world.houseGroup.position.clone() }); } catch(e){}
                                        try { if (world.plantGroup) list.push({ type: 'plant', name: 'PlantGroup', pos: world.plantGroup.position.clone() }); } catch(e){}
                                        // bosses in enemies array
                                        try {
                                            (window.game.enemies || []).forEach((en, idx) => {
                                                try {
                                                    if (en && en.name) list.push({ type: 'enemy', name: en.name, pos: en.mesh ? en.mesh.position.clone() : (en.position ? en.position.clone() : new THREE.Vector3()) });
                                                } catch (e) {}
                                            });
                                        } catch (e) {}
                                    }
                                    // render list
                                    list.forEach((it, i) => {
                                        const el = document.createElement('div');
                                        el.style.padding = '6px';
                                        el.style.borderBottom = '1px solid #eee';
                                        el.style.display = 'flex';
                                        el.style.justifyContent = 'space-between';
                                        el.style.alignItems = 'center';
                                        el.innerHTML = `<div style="font-weight:700">${it.name}</div><div style="font-size:12px;color:#666">(${it.type})</div>`;
                                        // details button
                                        const right = document.createElement('div');
                                        right.style.display = 'flex';
                                        right.style.gap = '6px';
                                        const view = document.createElement('button');
                                        view.textContent = 'View';
                                        view.style.padding = '6px';
                                        view.style.borderRadius = '6px';
                                        view.style.border = '0';
                                        view.style.background = '#1976D2';
                                        view.style.color = 'white';
                                        view.style.cursor = 'pointer';
                                        view.onclick = () => {
                                            try {
                                                alert(`${it.name}\nType: ${it.type}\nPosition: ${it.pos.x.toFixed(2)}, ${it.pos.y.toFixed(2)}, ${it.pos.z.toFixed(2)}`);
                                            } catch (e) {}
                                        };
                                        right.appendChild(view);
                                        el.appendChild(right);
                                        container.appendChild(el);
                                    });
                                    if (list.length === 0) container.innerHTML = '<div style="color:#777;padding:8px;">No objects found in-world yet.</div>';
                                } catch (e) { container.innerHTML = '<div style="color:#a00;padding:8px;">Failed to enumerate objects.</div>'; }
                            };

                            document.getElementById('le-refresh').addEventListener('click', fillObjects);
                            document.getElementById('le-save').addEventListener('click', () => {
                                try {
                                    // snapshot minimal level: object names + positions + music list
                                    const objs = [];
                                    const world = window.game && window.game.world;
                                    const player = window.game && window.game.player && window.game.player.mesh;
                                    if (player) objs.push({ id: 'player', name: 'Player', pos: { x: player.position.x, y: player.position.y, z: player.position.z } });
                                    if (world) {
                                        ['cashy','builderG','dancingBanana','parrot','babyCapybara','chromebook'].forEach(k => {
                                            try {
                                                const o = world[k];
                                                if (o && o.position) objs.push({ id: k, name: o.name || k, pos: { x: o.position.x, y: o.position.y, z: o.position.z } });
                                            } catch (e) {}
                                        });
                                        if (world.houseGroup) objs.push({ id: 'house', name: 'HouseGroup', pos: { x: world.houseGroup.position.x, y: world.houseGroup.position.y, z: world.houseGroup.position.z } });
                                        if (world.plantGroup) objs.push({ id: 'plant', name: 'PlantGroup', pos: { x: world.plantGroup.position.x, y: world.plantGroup.position.y, z: world.plantGroup.position.z } });
                                    }
                                    const musicList = JSON.parse(localStorage.getItem('mod_level_editor_music') || '[]');
                                    const level = { createdAt: Date.now(), objects: objs, music: musicList };
                                    localStorage.setItem('mod_level_editor_save', JSON.stringify(level));
                                    alert('Level saved to localStorage (mod_level_editor_save).');
                                } catch (e) {
                                    console.warn('Level save failed', e);
                                    alert('Save failed (see console).');
                                }
                            });

                            // import URL handler
                            document.getElementById('le-import-url').addEventListener('click', () => {
                                try {
                                    const url = document.getElementById('le-music-url').value.trim();
                                    if (!url) { alert('Enter a URL'); return; }
                                    const list = JSON.parse(localStorage.getItem('mod_level_editor_music') || '[]');
                                    list.push({ type: 'url', src: url, addedAt: Date.now() });
                                    localStorage.setItem('mod_level_editor_music', JSON.stringify(list));
                                    document.getElementById('le-music-list').textContent = `Imported: ${url}`;
                                    // show in preview if direct audio
                                    const preview = document.getElementById('le-audio-preview');
                                    preview.src = url;
                                    preview.load();
                                } catch (e) { console.warn('Import URL failed', e); alert('Import failed'); }
                            });

                            // import file handler
                            document.getElementById('le-import-file').addEventListener('click', async () => {
                                try {
                                    const fileInput = document.getElementById('le-music-file');
                                    const f = fileInput.files && fileInput.files[0];
                                    if (!f) { alert('Choose a file first'); return; }
                                    // create object URL and save entry
                                    const url = URL.createObjectURL(f);
                                    const list = JSON.parse(localStorage.getItem('mod_level_editor_music') || '[]');
                                    list.push({ type: 'file', name: f.name, src: url, addedAt: Date.now() });
                                    localStorage.setItem('mod_level_editor_music', JSON.stringify(list));
                                    document.getElementById('le-music-list').textContent = `Uploaded: ${f.name}`;
                                    const preview = document.getElementById('le-audio-preview');
                                    preview.src = url;
                                    preview.load();
                                } catch (e) { console.warn('Import file failed', e); alert('Upload failed'); }
                            });

                            // keyboard: ESC closes editor
                            const escHandler = (ev) => {
                                if (ev.key && ev.key === 'Escape') {
                                    try { document.getElementById('le-close').click(); } catch(e) {}
                                }
                            };
                            document.addEventListener('keydown', escHandler);
                            // cleanup on close handler will remove this listener
                            document.getElementById('le-close').addEventListener('click', () => {
                                try {
                                    editor.style.display = 'none';
                                    // remove listener
                                    document.removeEventListener('keydown', escHandler);
                                } catch (e) {}
                            });

                            // initial fill
                            fillObjects();
                        } else {
                            editor.style.display = 'block';
                        }
                    } catch (err) {
                        console.warn('Opening Level Editor failed', err);
                    }
                });

                dlg.querySelector('#mod-close').addEventListener('click', () => { try { dlg.style.display = 'none'; } catch(e){} });

            } else {
                dlg.style.display = 'flex';
            }
            return dlg;
        } catch (e) {
            console.warn('openModMenu failed', e);
            return null;
        }
    };

    // bind '8' key to open mod menu
    window.addEventListener('keydown', (ev) => {
        try {
            if (!ev || !ev.key) return;
            if (ev.key === '8') {
                if (window.game && typeof window.game.openModMenu === 'function') {
                    window.game.openModMenu();
                }
            }
        } catch (e) {}
    });

    // flying mode small effect: gently lift player when _flyingMode is active (non-invasive)
    const origAnimate = (typeof window.game !== 'undefined' && window.game.animate) ? window.game.animate.bind(window.game) : null;
    if (origAnimate && window.game) {
        window.game.animate = function () {
            try {
                if (this._flyingMode && this.player && this.player.mesh) {
                    // gentle floating bob
                    const yBase = 0.5;
                    const bob = Math.sin(Date.now() * 0.002) * 0.35;
                    try { this.player.mesh.position.y = yBase + bob; } catch(e){}
                }
            } catch (e) {}
            return origAnimate();
        }.bind(window.game);
    }
});

  // Delegated handler for the Ruined Ones boss button (ensures handler exists even if button created later)
document.addEventListener('click', (ev) => {
    try {
        if (!ev || !ev.target) return;
        const id = ev.target.id || (ev.target.dataset && ev.target.dataset.id);

        if (id === 'bf-ruined') {
            if (window.game && typeof window.game.spawnRuinedOnes === 'function') {
                window.game.spawnRuinedOnes();
            }
            return;
        }

        // Delegated handler for Redman boss button (ensures handler exists even if button created later)
        if (id === 'bf-redman') {
            try {
                if (window.game && typeof window.game.spawnRedmanBoss === 'function') {
                    // close any open dialog and spawn Redman boss
                    const dlg = document.getElementById('boss-selector-dialog');
                    if (dlg) dlg.style.display = 'none';
                    window.game.spawnRedmanBoss();
                } else {
                    // fallback: notify user
                    alert('Redman spawn not available yet.');
                }
            } catch (innerErr) {
                console.warn('Failed to spawn Redman via delegated handler', innerErr);
            }
            return;
        }

        // Delegated handler for Evil Capybara boss (new)
        if (id === 'bf-evilcapy') {
            try {
                if (window.game && typeof window.game.spawnEvilCapybaraBoss === 'function') {
                    const dlg = document.getElementById('boss-selector-dialog');
                    if (dlg) dlg.style.display = 'none';
                    window.game.spawnEvilCapybaraBoss();
                } else {
                    alert('Evil Capybara spawn not available.');
                }
            } catch (err) {
                console.warn('Failed to spawn Evil Capybara via delegated handler', err);
            }
            return;
        }
    } catch (e) {}
});

/* Multiplayer server helpers: createServer / joinServer allow simple server creation (in-memory) and auto-join.
   createServer(serverId, maxPlayers, mode, map) -> Promise
   joinServer(serverId) -> Promise
*/
Game.prototype.createServer = async function (serverId, maxPlayers = 8, mode = 'normal', map = 'garden') {
    try {
        // lightweight registry on the window so multiple tabs/clients can be simulated in-session
        window._servers = window._servers || {};
        if (!serverId) serverId = `server-${Math.floor(Math.random()*9000)+1000}`;
        if (window._servers[serverId]) {
            // if already exists, still attempt to join it if space
            const existing = window._servers[serverId];
            if (Object.keys(existing.players || {}).length >= (existing.maxPlayers || 40)) {
                throw new Error('Server full');
            }
        } else {
            window._servers[serverId] = { id: serverId, maxPlayers: Math.min(40, Math.max(1, Number(maxPlayers)||8)), mode, map, players: {} };
        }

        // ensure multiplayer socket is initialized (game.initMultiplayer exists)
        try {
            if (!this.room) await this.initMultiplayer();
        } catch (e) {
            // ignore failure to init remote websockets; still create a local registry
        }

        // join server as this client
        const clientKey = (this.room && this.room.clientId) ? this.room.clientId : (`local-${Math.floor(Math.random()*99999)}`);
        window._servers[serverId].players[clientKey] = { username: (this.room && this.room.peers && this.room.peers[clientKey] && this.room.peers[clientKey].username) ? this.room.peers[clientKey].username : 'Player' };
        this.server = window._servers[serverId];

        // store server info on room for convenience (best-effort)
        if (this.room) this.room.serverId = serverId;

        // apply selected mode/map to the game immediately
        try {
            this.enemySpawnThreshold = (this.server.mode && this.server.mode.includes('fast')) ? 0.6 : (this.enemySpawnThreshold || 3);
            // teleport to map using existing teleport flow
            window._teleportOverride = this.server.map || 'garden';
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'q' }));
        } catch (e) {}

        // set a small announcement
        if (this._announcementText) this._announcementText.textContent = `Created & joined server ${serverId} • map: ${this.server.map} • mode: ${this.server.mode}`;
        return Promise.resolve();
    } catch (err) {
        return Promise.reject(err);
    }
};

Game.prototype.joinServer = async function (serverId) {
    try {
        window._servers = window._servers || {};
        const entry = window._servers[serverId];
        if (!entry) throw new Error('Server not found');
        const count = Object.keys(entry.players || {}).length;
        if (count >= (entry.maxPlayers || 40)) throw new Error('Server full');

        // ensure multiplayer socket is initialized
        try {
            if (!this.room) await this.initMultiplayer();
        } catch (e) {}

        const clientKey = (this.room && this.room.clientId) ? this.room.clientId : (`local-${Math.floor(Math.random()*99999)}`);
        entry.players[clientKey] = { username: (this.room && this.room.peers && this.room.peers[clientKey] && this.room.peers[clientKey].username) ? this.room.peers[clientKey].username : 'Player' };
        this.server = entry;

        // note server id on room
        if (this.room) this.room.serverId = serverId;

        // teleport to map if provided
        try {
            window._teleportOverride = (entry.map || 'garden');
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'q' }));
        } catch (e) {}

        if (this._announcementText) this._announcementText.textContent = `Joined server ${serverId} • players: ${Object.keys(entry.players).length}/${entry.maxPlayers}`;
        return Promise.resolve();
    } catch (err) {
        return Promise.reject(err);
    }
};

/* First-person helper: enable and disable pointer-lock WASD first-person controls for IShowMaps.
   This adds fpYaw/fpPitch, fpKeys and pointerlock/mouse handlers; kept minimal & only active when enabled.
*/
Game.prototype.enableFirstPersonMode = function () {
    try {
        this.firstPerson = true;
        this.fpYaw = this.fpYaw || 0;
        this.fpPitch = this.fpPitch || 0;
        this.fpKeys = this.fpKeys || { forward:false, back:false, left:false, right:false };

        // Request pointer lock when the canvas is clicked to capture mouse movement
        const canvas = this.renderer && this.renderer.domElement ? this.renderer.domElement : document.body;
        const requestLock = () => {
            try {
                if (canvas.requestPointerLock) canvas.requestPointerLock();
            } catch (e) {}
        };
        canvas.style.cursor = 'none';
        canvas.addEventListener('click', requestLock, { once: true });

        // Mouse move handler updates yaw/pitch when pointer is locked
        const onMouseMove = (ev) => {
            try {
                if (document.pointerLockElement !== canvas && document.pointerLockElement !== document.body) return;
                const movementX = ev.movementX || ev.mozMovementX || ev.webkitMovementX || 0;
                const movementY = ev.movementY || ev.mozMovementY || ev.webkitMovementY || 0;
                // sensitivity
                const sens = 0.0022;
                this.fpYaw = (this.fpYaw || 0) - movementX * sens;
                this.fpPitch = (this.fpPitch || 0) - movementY * sens;
                // clamp pitch
                const maxPitch = Math.PI * 0.47;
                this.fpPitch = Math.max(-maxPitch, Math.min(maxPitch, this.fpPitch));
            } catch (e) {}
        };
        document.addEventListener('mousemove', onMouseMove);

        // Keyboard handlers: WASD and arrows
        const keyMap = {
            'w': 'forward', 'arrowup': 'forward',
            's': 'back', 'arrowdown': 'back',
            'a': 'left', 'arrowleft': 'left',
            'd': 'right', 'arrowright': 'right'
        };
        const onKeyDown = (ev) => {
            try {
                const k = (ev.key || '').toLowerCase();
                const mapped = keyMap[k];
                if (mapped) { this.fpKeys[mapped] = true; ev.preventDefault && ev.preventDefault(); }
            } catch (e) {}
        };
        const onKeyUp = (ev) => {
            try {
                const k = (ev.key || '').toLowerCase();
                const mapped = keyMap[k];
                if (mapped) { this.fpKeys[mapped] = false; ev.preventDefault && ev.preventDefault(); }
            } catch (e) {}
        };
        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('keyup', onKeyUp);

        // Listen for pointer lock change to set cursor and to rebind click to re-request lock if unlocked
        const onPointerChange = () => {
            try {
                if (document.pointerLockElement === canvas) {
                    canvas.style.cursor = 'none';
                } else {
                    canvas.style.cursor = '';
                    // allow re-requesting on next click
                    canvas.addEventListener('click', requestLock, { once: true });
                }
            } catch (e) {}
        };
        document.addEventListener('pointerlockchange', onPointerChange);
        document.addEventListener('mozpointerlockchange', onPointerChange);
    } catch (e) { console.warn('enableFirstPersonMode failed', e); }
};

Game.prototype.disableFirstPersonMode = function () {
    try {
        this.firstPerson = false;
        // restore player mesh visibility
        try { if (this.player && this.player.mesh) this.player.mesh.visible = true; } catch(e){}
        try {
            if (document.exitPointerLock) document.exitPointerLock();
        } catch (e) {}
        // clear key states
        this.fpKeys = { forward:false, back:false, left:false, right:false };
        // leave camera to follow player in third-person by resetting position in animate
    } catch (e) { console.warn('disableFirstPersonMode failed', e); }
};

/* Practice Mode: small tutorial to teach the player how to kill enemies.
   Spawns a single slow enemy, displays step-by-step instructions, and plays short tutorial music.
*/
Game.prototype.startPracticeMode = function () {
    try {
        // Reset some states for practice
        this.gameState.isSurvival = false;
        this.gameState.gameOver = false;
        // Teleport player to a small practice arena near origin
        try {
            this.player.mesh.position.set(0, 0, 0);
            if (this.world) this.world.playerPosition = this.player.mesh.position;
            // clear existing enemies
            this.enemies.forEach(en => { try { if (en && en.destroy) en.destroy(); else if (en && en.mesh) this.scene.remove(en.mesh); } catch(e) {} });
            this.enemies = [];
        } catch (e) {}

        // Spawn a single slow enemy for the player to practice killing
        try {
            const p = this.player.mesh.position.clone();
            const spawnPos = p.clone().add(new THREE.Vector3(6, 0, 0));
            const enemy = new Enemy(this.scene, spawnPos);
            enemy.speed = 0.9; // slow so players can learn targeting
            // small friendly label sprite above enemy to mark practice target
            try {
                const loader = new THREE.TextureLoader();
                const txt = loader.load('/warning-sign-icon-transparent-background-free-png.webp');
                const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: txt, transparent: true }));
                s.scale.set(0.8, 0.8, 1);
                s.position.copy(spawnPos).add(new THREE.Vector3(0, 2.2, 0));
                this.scene.add(s);
                // auto-remove label when enemy dies
                const originalDestroy = enemy.destroy.bind(enemy);
                enemy.destroy = () => {
                    try { originalDestroy(); } catch(e){}
                    try { this.scene.remove(s); } catch(e){}
                };
            } catch (e) {}
            this.enemies.push(enemy);
        } catch (e) { console.warn('Practice enemy spawn failed', e); }

        // Show tutorial overlay with concise steps for killing enemies
        try {
            let tut = document.getElementById('practice-tutorial');
            if (!tut) {
                tut = document.createElement('div');
                tut.id = 'practice-tutorial';
                tut.style.position = 'fixed';
                tut.style.left = '50%';
                tut.style.top = '12%';
                tut.style.transform = 'translateX(-50%)';
                tut.style.zIndex = '10006';
                tut.style.background = 'rgba(0,0,0,0.85)';
                tut.style.color = 'white';
                tut.style.padding = '12px 14px';
                tut.style.borderRadius = '10px';
                tut.style.fontFamily = 'Segoe UI, Tahoma, sans-serif';
                tut.style.maxWidth = '520px';
                tut.style.textAlign = 'left';
                tut.innerHTML = `
                    <div style="font-weight:900;font-size:16px;margin-bottom:8px;">Practice Mode — Combat Tutorial</div>
                    <ol style="margin:0 0 8px 18px;font-size:14px;line-height:1.4;color:#ddd;">
                      <li>Move toward the enemy by holding mouse/touch or using joystick/WASD.</li>
                      <li>Face the enemy; press <strong>D</strong> to shoot and damage enemies in front of you.</li>
                      <li>Press <strong>S</strong> to throw a bomb that kills nearby enemies.</li>
                      <li>Try to defeat the target enemy; when it's defeated, the tutorial ends.</li>
                    </ol>
                    <div style="display:flex;gap:8px;justify-content:flex-end;">
                      <button id="practice-end-btn" style="padding:8px 12px;border-radius:8px;border:0;background:#4CAF50;color:white;cursor:pointer;">End Practice</button>
                    </div>
                `;
                document.body.appendChild(tut);
            } else {
                tut.style.display = 'block';
            }

            document.getElementById('practice-end-btn').onclick = () => {
                try { document.getElementById('practice-tutorial').style.display = 'none'; } catch(e){}
                // clear practice enemies
                try {
                    this.enemies.forEach(en => { try { if (en && en.destroy) en.destroy(); else if (en && en.mesh) this.scene.remove(en.mesh); } catch(e){} });
                    this.enemies = [];
                } catch (err) {}
            };
        } catch (e) { console.warn('Failed to create practice overlay', e); }

        // Play tutorial music (short loop) — always attempt play even if alerts toggle is set, but fail safely
        try {
            try { this.playSound('tutorial'); } catch (e) {}
        } catch (e) {}

        // Announcement
        if (this._announcementText) {
            this._announcementText.textContent = 'Practice Mode started — learn to kill enemies (D = shoot, S = bomb).';
            setTimeout(()=>{ try{ this._announcementText.textContent='UPDATES MORE SOON!'; }catch(e){} }, 3000);
        }
    } catch (e) {
        console.warn('startPracticeMode failed', e);
    }
};

// New: Tutorial map (only Cashy) with step-by-step guidance, and unlock/save logic
Game.prototype.startTutorialMap = function () {
    try {
        // clear enemies and set simple non-survival tutorial state
        this.gameState.isSurvival = false;
        this.gameState.gameOver = false;
        this.enemies.forEach(en => { try { if (en && en.destroy) en.destroy(); else if (en && en.mesh) this.scene.remove(en.mesh); } catch(e){} });
        this.enemies = [];

        // Teleport player to tutorial area
        try { this.player.mesh.position.set(0, 0, 0); if (this.world) this.world.playerPosition = this.player.mesh.position; } catch(e){}

        // Ensure only Cashy is present: remove other pets and create Cashy if missing
        try {
            ['builderG','dancingBanana','parrot','babyCapybara','chromebook'].forEach(k => { try { if (this.world && this.world[k]) { this.scene.remove(this.world[k]); this.world[k] = null; } } catch(e){} });
            if (!this.world.cashy) {
                const tex = new THREE.TextureLoader().load('/Charcther_icon.webp');
                const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
                const sprite = new THREE.Sprite(mat);
                sprite.scale.set(2,2,1);
                sprite.position.set(-2, 1, 0);
                this.scene.add(sprite);
                sprite.originalY = 1;
                sprite.velocity = 0;
                sprite.isPetting = false;
                sprite.hp = 100;
                sprite.name = 'Cashy';
                this.world.cashy = sprite;
            } else {
                // reposition Cashy to tutorial spot
                try { this.world.cashy.position.set(-2,1,0); } catch(e){}
            }
        } catch (e) { console.warn('Failed to setup Cashy for tutorial', e); }

        // Create tutorial overlay with sequential steps and simple button progression
        try {
            let tut = document.getElementById('tutorial-map-overlay');
            if (!tut) {
                tut = document.createElement('div');
                tut.id = 'tutorial-map-overlay';
                tut.style.position = 'fixed';
                tut.style.left = '50%';
                tut.style.top = '8%';
                tut.style.transform = 'translateX(-50%)';
                tut.style.zIndex = '10006';
                tut.style.background = 'rgba(255,255,255,0.95)';
                tut.style.color = '#111';
                tut.style.padding = '12px 14px';
                tut.style.borderRadius = '10px';
                tut.style.fontFamily = 'Segoe UI, Tahoma, sans-serif';
                tut.style.maxWidth = '520px';
                tut.innerHTML = `
                    <div style="font-weight:900;font-size:16px;margin-bottom:8px;">Tutorial — Cashy Training</div>
                    <div id="tutorial-steps" style="font-size:14px;color:#222;line-height:1.45;">
                      1) Press <strong>S</strong> to kill the enemy (we'll spawn one).<br>
                      2) Move your Capybara by holding the mouse or touch (hold to move).<br>
                      3) Great job — now pet Cashy (approach Cashy).<br>
                      4) If Builder G appears later, stand near Builder G to activate defenses to kill enemies.<br>
                      5) After completing steps, maps & Campaign mode unlock and your data will be saved.
                    </div>
                    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px;">
                      <button id="tutorial-skip" style="padding:8px 12px;border-radius:8px;border:0;background:#bdbdbd;color:#111;cursor:pointer;">Skip</button>
                      <button id="tutorial-start" style="padding:8px 12px;border-radius:8px;border:0;background:#4CAF50;color:white;cursor:pointer;">Start Tutorial</button>
                    </div>
                `;
                document.body.appendChild(tut);
            } else tut.style.display = 'block';

            document.getElementById('tutorial-skip').onclick = () => {
                try { document.getElementById('tutorial-map-overlay').style.display = 'none'; } catch(e){}
            };

            document.getElementById('tutorial-start').onclick = () => {
                try {
                    document.getElementById('tutorial-map-overlay').style.display = 'none';
                    // spawn a single slow enemy near player for step 1
                    const p = this.player.mesh.position.clone();
                    const spawnPos = p.clone().add(new THREE.Vector3(6, 0, 0));
                    const e = new Enemy(this.scene, spawnPos);
                    e.speed = 0.4;
                    e.name = 'TutorialEnemy';
                    this.enemies.push(e);
                    // set a small flag so 'S' key will attempt to kill nearest enemy for the player action
                    this._tutorialActive = true;
                    this._tutorialStage = 1;

                    if (this._announcementText) {
                        this._announcementText.textContent = 'Tutorial started — press S to kill the enemy.';
                        setTimeout(()=>{ try{ this._announcementText.textContent='UPDATES MORE SOON!'; }catch(e){} }, 2200);
                    }
                } catch (err) { console.warn('Failed to start tutorial spawn', err); }
            };
        } catch (e) { console.warn('Failed to create tutorial overlay', e); }

        // Hook a one-time watcher for petting Cashy and completing tutorial
        // We'll poll in a short interval to detect stage progress
        try {
            const tick = setInterval(() => {
                try {
                    if (!this._tutorialActive) { clearInterval(tick); return; }
                    // Stage 1: wait for enemy destroyed (player uses S to trigger kill)
                    if (this._tutorialStage === 1) {
                        const hasEnemy = this.enemies.some(en => en && en.name && en.name.toLowerCase().includes('tutorialenemy') && en.alive);
                        if (!hasEnemy) {
                            this._tutorialStage = 2;
                            if (this._announcementText) { this._announcementText.textContent = 'Enemy defeated — now move and approach Cashy to pet.'; setTimeout(()=>{ try{ this._announcementText.textContent='UPDATES MORE SOON!'; }catch(e){} },2000); }
                        }
                    }
                    // Stage 2: detect petting Cashy (proximity)
                    if (this._tutorialStage === 2) {
                        if (this.world && this.world.cashy) {
                            const d = this.player.mesh.position.distanceTo(this.world.cashy.position);
                            if (d < 1.6) {
                                // pet recognized: increase pet counter and stage complete
                                this.gameState.pets = (this.gameState.pets || 0) + 1;
                                try { document.getElementById('pet-counter').textContent = this.gameState.pets; } catch(e){}
                                this._tutorialStage = 3;
                                if (this._announcementText) { this._announcementText.textContent = 'Cashy petted — tutorial almost complete.'; setTimeout(()=>{ try{ this._announcementText.textContent='UPDATES MORE SOON!'; }catch(e){} },1800); }
                            }
                        }
                    }
                    // Stage 3: finalize tutorial: unlock maps, campaign, save data
                    if (this._tutorialStage === 3) {
                        this._tutorialActive = false;
                        this._tutorialStage = 0;
                        clearInterval(tick);

                        // Unlock new map entries & campaign flag stored in localStorage
                        try {
                            const meta = { unlockedMaps: ['floor-house'], campaignUnlocked: true, tutorialCompletedAt: Date.now() };
                            localStorage.setItem('capybara_tutorial_unlocks', JSON.stringify(meta));
                        } catch (e) { console.warn('Failed to save tutorial unlocks', e); }

                        // Provide a visible UI reward and announcement
                        try {
                            if (this._announcementText) this._announcementText.textContent = 'Tutorial complete — Floor House map & Campaign unlocked! Your data has been saved.';
                            // simple modal
                            const dlg = document.createElement('div');
                            dlg.style.position = 'fixed';
                            dlg.style.left = '50%';
                            dlg.style.top = '18%';
                            dlg.style.transform = 'translateX(-50%)';
                            dlg.style.zIndex = '10007';
                            dlg.style.background = 'rgba(255,255,255,0.97)';
                            dlg.style.color = '#111';
                            dlg.style.padding = '12px';
                            dlg.style.borderRadius = '10px';
                            dlg.style.boxShadow = '0 12px 30px rgba(0,0,0,0.25)';
                            dlg.innerHTML = `<div style="font-weight:900;margin-bottom:8px;">Unlocked</div><div style="margin-bottom:8px;">New Map: Floor House<br>New Gamemode: Campaign (Daily Defenses levels)</div><div style="display:flex;justify-content:flex-end;"><button id="unlock-ok" style="padding:8px 12px;border-radius:8px;border:0;background:#1976D2;color:#fff;">OK</button></div>`;
                            document.body.appendChild(dlg);
                            document.getElementById('unlock-ok').onclick = () => { try { dlg.remove(); } catch(e){} };
                        } catch (e) {}

                        // Save a simple persisted save record for campaign progression
                        try {
                            const save = { campaign: { levelsUnlocked: [1], current: 1 }, savedAt: Date.now() };
                            localStorage.setItem('capybara_save', JSON.stringify(save));
                        } catch (e) { console.warn('Failed to save campaign progress', e); }

                        // As a celebratory step, spawn the Cursed Face (boss) for the tutorial finale demonstration, but keep it optional
                        try {
                            // spawn but do not force player into survival; the boss will be non-lethal demo until engaged
                            if (typeof this.spawnEatererBoss === 'function') {
                                this.spawnEatererBoss();
                            } else {
                                console.warn('spawnEatererBoss not available for tutorial finale.');
                            }
                        } catch (e) { console.warn('Failed to spawn Cursed Face after tutorial', e); }
                    }
                } catch (e) {}
            }, 500);
        } catch (e) { console.warn('Tutorial stage watcher failed', e); }
    } catch (e) {
        console.warn('startTutorialMap failed', e);
    }
};

// Spawn the Cursed Face boss using the provided image (image (1).png), with a fireball attack and 100 HP; on defeat it speaks a final garbled line.
Game.prototype.spawnCursedFace = function () {
    try {
        if (this._cursedFace && this._cursedFace.alive) {
            // reposition for demo
            try { this._cursedFace.mesh.position.copy(this.player.mesh.position).add(new THREE.Vector3(0,6,-8)); } catch(e){}
            return;
        }
        const loader = new THREE.TextureLoader();
        const tex = loader.load('/image (1).png');
        const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
        const sprite = new THREE.Sprite(mat);
        sprite.scale.set(6,6,1);
        sprite.position.copy(this.player.mesh.position).add(new THREE.Vector3(0,6,-8));
        this.scene.add(sprite);

        const boss = {
            name: 'The Cursed Face',
            alive: true,
            mesh: sprite,
            hp: 100,
            fireTimer: 1.8,
            fireCooldown: 1.8,
            update: (tp, dt) => {
                if (!boss.alive) return;
                try {
                    // hover slowly and face player
                    boss.mesh.position.y = 5.8 + Math.sin(Date.now() * 0.0015) * 0.35;
                    const dir = new THREE.Vector3().subVectors(this.player.mesh.position, boss.mesh.position);
                    dir.y = 0;
                    if (dir.length() > 0.01) {
                        const yaw = Math.atan2(dir.x, dir.z);
                        boss.mesh.rotation.y = yaw;
                    }
                    boss.fireTimer -= dt;
                    if (boss.fireTimer <= 0) {
                        boss.fireTimer = boss.fireCooldown + Math.random() * 0.6;
                        // spawn a single fireball towards player
                        const ballMat = new THREE.MeshStandardMaterial({ color: 0xff6633, emissive: 0xff2200, emissiveIntensity: 1.2 });
                        const ballGeo = new THREE.SphereGeometry(0.28, 8, 8);
                        const ball = new THREE.Mesh(ballGeo, ballMat);
                        const start = boss.mesh.position.clone().add(new THREE.Vector3((Math.random()-0.5)*1.2, -0.6, (Math.random()-0.5)*1.2));
                        ball.position.copy(start);
                        ball.userData.dir = new THREE.Vector3().subVectors(this.player.mesh.position.clone().add(new THREE.Vector3(0,0.9,0)), start).normalize();
                        ball.userData.speed = 9;
                        ball.userData.spawnTime = Date.now();
                        ball.userData.maxLifeMs = 12000;
                        this.scene.add(ball);

                        const proj = {
                            alive: true,
                            mesh: ball,
                            update: (tp, dtdt) => {
                                if (!proj.alive) return;
                                proj.mesh.position.add(proj.mesh.userData.dir.clone().multiplyScalar(proj.mesh.userData.speed * dtdt));
                                if (proj.mesh.position.distanceTo(this.player.mesh.position) < 1.1) {
                                    // when tutorial active, fireball removes pets and deals moderate damage
                                    try {
                                        this.player.hp = (this.player.hp === undefined) ? 100 : this.player.hp;
                                        this.player.hp -= 18;
                                        // pets vanish on hit
                                        ['cashy','builderG','dancingBanana','babyCapybara','chromebook','parrot'].forEach(k => {
                                            try { if (this.world && this.world[k]) { this.scene.remove(this.world[k]); this.world[k] = null; } } catch(e){}
                                        });
                                        proj.alive = false;
                                        try { this.scene.remove(proj.mesh); } catch(e){}
                                    } catch (e) {}
                                }
                                if (Date.now() - (proj.mesh.userData.spawnTime || 0) > (proj.mesh.userData.maxLifeMs || 12000)) {
                                    proj.alive = false; try { this.scene.remove(proj.mesh); } catch(e){}
                                }
                            },
                            destroy: () => { proj.alive = false; try { this.scene.remove(proj.mesh); } catch(e){} }
                        };
                        this.enemies.push(proj);
                        if (this.alertsEnabled) this.playSound('bomb');
                    }
                } catch (e) {}
            },
            takeDamage: (amt) => {
                boss.hp -= (amt || 20);
                if (boss.hp <= 0) {
                    boss.alive = false;
                    try { this.scene.remove(boss.mesh); } catch(e){}
                    // final garbled speaking line via SpeechSynthesis (fallback)
                    try {
                        const utter = new SpeechSynthesisUtterance("GRESERFRERTFRRr rs hAgsdfwr sd wrdseuyfkex and $dj5fs46g d KAD[[EBARAD FWE");
                        window.speechSynthesis.cancel();
                        window.speechSynthesis.speak(utter);
                    } catch (e) {}
                    // announcement
                    if (this._announcementText) { this._announcementText.textContent = 'You defeated The Cursed Face!'; setTimeout(()=>{ try{ this._announcementText.textContent='UPDATES MORE SOON!'; }catch(e){} },2000); }
                } else {
                    if (this._announcementText) this._announcementText.textContent = `Cursed Face HP: ${boss.hp}`;
                }
            },
            destroy: () => { boss.alive = false; try { this.scene.remove(boss.mesh); } catch(e){} }
        };

        this._cursedFace = boss;
        this.enemies.push(boss);
        // make sure boss is updated via animate loop by being in enemies array
        if (this._announcementText) this._announcementText.textContent = 'A strange cursed face hovers nearby...';
    } catch (e) { console.warn('spawnCursedFace failed', e); }
};

// Allow queued mode 'tutorial' to start the tutorial map if set via menu earlier
(function pollQueuedTutorial() {
    try {
        const once = () => {
            try {
                if (window._queuedMode === 'tutorial' && window.game && typeof window.game.startTutorialMap === 'function') {
                    window.game.startTutorialMap();
                    window._queuedMode = null;
                }
            } catch (e) {}
        };
        setTimeout(once, 300);
        let attempts = 0;
        const t = setInterval(() => {
            attempts++;
            once();
            if (attempts > 40) clearInterval(t);
        }, 250);
    } catch (e) {}
})();



// Add Endless Mode starter so queued 'endless-mode' will run when requested
Game.prototype.startEndlessMode = function () {
    try {
        // Basic mode flags and setup
        this.gameState.endlessMode = {
            active: true,
            noPets: true,
            teacherQuizProgress: 0,
            notebooksNeeded: 6,
            playerHP: 100
        };

        // Enter first-person, boost player speed (no inversion)
        try { this.enableFirstPersonMode && this.enableFirstPersonMode(); } catch(e){}
        try { this.player.speed = 7.5; } catch(e){}

        // Remove pets from world (no pets for Endless Mode)
        try {
            const petKeys = ['cashy','builderG','dancingBanana','babyCapybara','parrot','chromebook'];
            petKeys.forEach(k => {
                try { if (this.world && this.world[k]) { this.scene.remove(this.world[k]); this.world[k] = null; } } catch(e){}
            });
            this.gameState.pets = 0;
            const petCounter = document.getElementById('pet-counter');
            if (petCounter) petCounter.textContent = '0';
        } catch (e) {}

        // Teleport player to a compact classroom arena for Endless Mode
        try {
            this.player.mesh.position.set(0, 1.2, -8);
            if (this.world) this.world.playerPosition = this.player.mesh.position;
            // adjust visuals slightly to a classroom tint
            this.scene.background = new THREE.Color(0xefe7d7);
            this.scene.fog = new THREE.FogExp2(0xefe7d7, 0.02);
        } catch (e) {}

        // Create a small on-screen HUD for the teacher quiz objective (notebooks)
        try {
            let hud = document.getElementById('endless-hud');
            if (!hud) {
                hud = document.createElement('div');
                hud.id = 'endless-hud';
                hud.style.position = 'fixed';
                hud.style.left = '18px';
                hud.style.top = '120px';
                hud.style.zIndex = '10005';
                hud.style.background = 'rgba(255,255,255,0.95)';
                hud.style.color = '#111';
                hud.style.padding = '8px';
                hud.style.borderRadius = '10px';
                hud.style.boxShadow = '0 8px 24px rgba(0,0,0,0.15)';
                hud.style.fontFamily = 'Segoe UI, Tahoma, sans-serif';
                hud.innerHTML = `<div style="font-weight:800;margin-bottom:6px;">Endless Mode — CC Quiz</div>
                                 <div id="endless-notebooks">Notebooks solved: 0 / ${this.gameState.endlessMode.notebooksNeeded}</div>
                                 <div style="font-size:12px;color:#666;margin-top:6px;">Answer CC's math questions to progress. Shift to run.</div>`;
                document.body.appendChild(hud);
            } else hud.style.display = 'block';
        } catch (e) {}

        // Spawn CC teacher sprite (principal) using capybara studying asset if available
        try {
            const loader = new THREE.TextureLoader();
            const tex = loader.load('/A-capybara-studying-up-for-his-finals-v0-u6949ggynee41.webp');
            const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
            const teacher = new THREE.Sprite(mat);
            teacher.scale.set(2.6, 2.6, 1);
            teacher.position.copy(this.player.mesh.position).add(new THREE.Vector3(0, 0, -6));
            teacher.position.y = 1.4;
            teacher.name = 'CC_Teacher';
            this.scene.add(teacher);
            this._endlessTeacher = teacher;
        } catch (e) {}

        // Place notebooks in world for the player to find/answer (simple collectibles)
        try {
            this._endlessNotebooks = this._endlessNotebooks || [];
            for (let i = 0; i < this.gameState.endlessMode.notebooksNeeded; i++) {
                const ang = Math.random() * Math.PI * 2;
                const r = 3 + Math.random() * 8;
                const pos = this.player.mesh.position.clone().add(new THREE.Vector3(Math.cos(ang) * r, 0.9, Math.sin(ang) * r));
                const nb = new THREE.Mesh(new THREE.BoxGeometry(0.4,0.02,0.28), new THREE.MeshStandardMaterial({ color: 0xffee88 }));
                nb.position.copy(pos);
                nb.userData.collected = false;
                nb.name = `endless_notebook_${i}`;
                this.scene.add(nb);
                this._endlessNotebooks.push(nb);
            }
        } catch (e) {}

        // Small instruction
        try {
            const instr = document.getElementById('instructions');
            if (instr) instr.innerHTML = "ENDLESS MODE — First-person. Collect and answer 6 notebooks to win; Shift to run; F to throw objects; wrong third answer makes CC chase faster.";
            instr.style.background = "rgba(0,0,0,0.72)";
        } catch (e) {}

        // Set survival-like enemy pressure minimal but enable CC chase on failures
        this.enemySpawnThreshold = 1.6;
        this.gameState.isSurvival = false;

        // Hook a simple per-frame check to handle notebook pickups and quiz progression
        if (!this._endlessInterval) {
            this._endlessInterval = setInterval(() => {
                try {
                    if (!this.gameState.endlessMode || !this.gameState.endlessMode.active) {
                        clearInterval(this._endlessInterval); this._endlessInterval = null; return;
                    }
                    // check notebook pickups
                    const playerPos = this.player.mesh.position;
                    for (const nb of (this._endlessNotebooks || [])) {
                        if (!nb || nb.userData.collected) continue;
                        const d = nb.position.distanceTo(playerPos);
                        if (d < 1.4) {
                            nb.userData.collected = true;
                            try { this.scene.remove(nb); } catch(e){}
                            // ask a short question sequence; third question wrong => speedup chase
                            const qIndex = (this.gameState.endlessMode.teacherQuizProgress % 3) + 1;
                            let promptQ = '';
                            if (qIndex === 1) promptQ = 'Q1: What is 4 + 9?';
                            else if (qIndex === 2) promptQ = 'Q2: What is 2 * 3?';
                            else promptQ = 'Q3: What is 72837627848763273847xw738isjkeiks-238383892=? (intentionally impossible)';

                            const ans = window.prompt(promptQ, '');
                            const correct = (qIndex === 1 && (ans === '13' || ans==='13.0')) || (qIndex === 2 && (ans === '6' || ans==='6.0'));
                            if (correct) {
                                this.gameState.endlessMode.teacherQuizProgress++;
                                // update HUD
                                const hudEl = document.getElementById('endless-notebooks');
                                if (hudEl) hudEl.textContent = `Notebooks solved: ${this.gameState.endlessMode.teacherQuizProgress} / ${this.gameState.endlessMode.notebooksNeeded}`;
                                // reward: small diamond spawn and message
                                this.spawnDiamondAt(this.player.mesh.position.clone().add(new THREE.Vector3(0,2,0)));
                                if (this._announcementText) this._announcementText.textContent = 'Correct answer — CC pleased!';
                            } else {
                                // if this was the third question and wrong, CC chases faster
                                if (qIndex === 3) {
                                    // set teacher to aggressive and increase chase
                                    try {
                                        if (this._endlessTeacher) this._endlessTeacher.userData.aggressive = true;
                                        // spawn a short chase: teacher will rapidly move toward player for 18s
                                        const oldChase = this._endlessTeacher ? (this._endlessTeacher.userData.chaseUntil || 0) : 0;
                                        const until = Date.now() + 18000;
                                        if (this._endlessTeacher) this._endlessTeacher.userData.chaseUntil = until;
                                        if (this._announcementText) this._announcementText.textContent = 'Wrong! CC is angry and will chase faster!';
                                    } catch(e){}
                                } else {
                                    if (this._announcementText) this._announcementText.textContent = 'Wrong answer — try the next notebook carefully.';
                                }
                            }

                            // mark global progress (use teacherQuizProgress as collected count too)
                            if (this.gameState.endlessMode.teacherQuizProgress >= this.gameState.endlessMode.notebooksNeeded) {
                                // Win: player escaped Endless Mode
                                this.gameState.endlessMode.active = false;
                                // cleanup HUD
                                try { const hud = document.getElementById('endless-hud'); if (hud) hud.style.display = 'none'; } catch(e){}
                                // reward and restore visuals
                                this.player.speed = 5;
                                this._announcementText && (this._announcementText.textContent = 'You completed CC quiz — Endless Mode cleared!');
                                // stop first-person mode
                                try { this.disableFirstPersonMode && this.disableFirstPersonMode(); } catch(e){}
                            }
                        }
                    }

                    // teacher chasing behavior if aggressive
                    try {
                        if (this._endlessTeacher && this._endlessTeacher.userData && this._endlessTeacher.userData.chaseUntil && Date.now() < this._endlessTeacher.userData.chaseUntil) {
                            const tpos = this._endlessTeacher.position;
                            const dir = new THREE.Vector3().subVectors(this.player.mesh.position, tpos);
                            dir.y = 0;
                            if (dir.length() > 0.05) {
                                dir.normalize();
                                this._endlessTeacher.position.add(dir.multiplyScalar(6.0 * (1/60)));
                            }
                            // if catches player, inflict a penalty
                            const dd = this._endlessTeacher.position.distanceTo(this.player.mesh.position);
                            if (dd < 1.2) {
                                this.player.hp = (this.player.hp===undefined)?100:this.player.hp;
                                this.player.hp -= 22;
                                if (this.player.hp <= 0) {
                                    this.gameState.gameOver = true;
                                    document.getElementById('instructions').innerHTML = 'GAME OVER — Caught by CC! Refresh to retry.';
                                }
                            }
                        }
                    } catch (e) {}

                } catch (e) {}
            }, 700);
        }

    } catch (e) {
        console.warn('startEndlessMode failed', e);
    }
};

// Check queued modes and trigger requested modes if queued while game was not yet initialized (poll once)
(function pollQueuedModes() {
    try {
        const handlers = {
            'three-day-watermelon': () => { return false; },
            'tutorial': () => { if (window.game && typeof window.game.startTutorialMap === 'function') { window.game.startTutorialMap(); return true; } return false; },
            'practice': () => { if (window.game && typeof window.game.startPracticeMode === 'function') { window.game.startPracticeMode(); return true; } return false; },
            'challenge-time': () => { if (window.game && typeof window.game.startChallengeTime === 'function') { window.game.startChallengeTime(); return true; } return false; },
            // Added: ensure queued "run-the-bosses" mode triggers the Run The Bosses gamemode when the game becomes available
            'run-the-bosses': () => { if (window.game && typeof window.game.startRunTheBosses === 'function') { window.game.startRunTheBosses(); return true; } return false; },
            // Endless Mode: first-person, no pets, CC teacher quiz (6 notebooks), grab/throw (S/F), banana slip effect and third-question penalty
            'endless-mode': () => { if (window.game && typeof window.game.startEndlessMode === 'function') { window.game.startEndlessMode(); return true; } return false; }
        };

        const once = () => {
            try {
                const q = window._queuedMode;
                if (!q) return;
                const fn = handlers[q];
                if (typeof fn === 'function') {
                    const done = fn();
                    if (done) window._queuedMode = null;
                }
            } catch (e) {}
        };

        // run shortly after game initialized and periodically for a short time
        setTimeout(once, 300);
        let attempts = 0;
        const t = setInterval(() => {
            attempts++;
            once();
            if (attempts > 80) clearInterval(t);
        }, 250);
    } catch (e) {}
})();

/* Challenge Time Mode: 27:01 countdown, collect 5 clocks to spawn a portal that teleports you into an unavoidable boss encounter (no escape). */
Game.prototype.startChallengeTime = function () {
    try {
        // reset relevant state
        this.gameState.isSurvival = true;
        this.gameState.gameOver = false;
        // 27 minutes + 1 second => convert to seconds (27*60 + 1)
        this.gameState.challengeTimeSeconds = 27 * 60 + 1;
        this.gameState.challengeClocksCollected = 0;
        this.gameState.challengeClocksTotal = 5;
        this.gameState.challengePortal = null;
        this.gameState.noEscape = true; // player's escape disabled once portal appears

        // teleport player to small arena center and clear enemies for clarity
        try {
            this.player.mesh.position.set(0, 0, 0);
            if (this.world) this.world.playerPosition = this.player.mesh.position;
            this.enemies.forEach(en => { try { if (en && en.destroy) en.destroy(); else if (en && en.mesh) this.scene.remove(en.mesh); } catch(e){} });
            this.enemies = [];
        } catch (e) {}

        // spawn 5 clock sprites around player
        this._challengeClocks = [];
        try {
            const loader = new THREE.TextureLoader();
            const clockTex = loader.load('/videoframe_1086.png'); // reuse a small frame asset as clock icon
            for (let i = 0; i < this.gameState.challengeClocksTotal; i++) {
                const ang = (i / this.gameState.challengeClocksTotal) * Math.PI * 2 + Math.random() * 0.3;
                const r = 6 + Math.random() * 6;
                const pos = new THREE.Vector3(Math.cos(ang) * r, 1.2, Math.sin(ang) * r);
                const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: clockTex, transparent: true }));
                spr.scale.set(1.2, 1.2, 1);
                spr.position.copy(pos);
                spr.userData.isClock = true;
                spr.userData.collected = false;
                this.scene.add(spr);
                this._challengeClocks.push(spr);
            }
        } catch (e) {
            console.warn('Failed to spawn challenge clocks', e);
        }

        // show overlay instructions
        try {
            const instr = document.getElementById('instructions');
            if (instr) instr.innerHTML = `CHALLENGE TIME — Collect ${this.gameState.challengeClocksTotal} clocks before the red timer ends: 27:01`;
            if (this._announcementText) {
                this._announcementText.textContent = 'Challenge Time started — collect clocks to open the portal!';
                setTimeout(()=>{ try{ this._announcementText.textContent='UPDATES MORE SOON!'; }catch(e){} }, 3000);
            }
        } catch (e) {}

        // play subtle alert
        if (this.alertsEnabled) this.playSound('day');
    } catch (e) {
        console.warn('startChallengeTime failed', e);
    }
};

// Helper: spawn portal at player's position to teleport to unavoidable boss encounter
Game.prototype._spawnChallengePortal = function () {
    try {
        if (this.gameState.challengePortal) return;
        const loader = new THREE.TextureLoader();
        const tex = loader.load('/warning-sign-icon-transparent-background-free-png.webp');
        const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
        spr.scale.set(3.6, 3.6, 1);
        spr.position.copy(this.player.mesh.position).add(new THREE.Vector3(0, 1.2, -4));
        spr.userData.isPortal = true;
        this.scene.add(spr);
        this.gameState.challengePortal = spr;
        // update instructions
        try { const instr = document.getElementById('instructions'); if (instr) instr.innerHTML = 'All clocks collected — Portal active! Approach to enter (no escape).'; } catch(e){}
    } catch (e) { console.warn('Spawn Challenge Portal failed', e); }
};

const game = new Game();

// When Cashy reaches 3 kills, spawn a clickable playing-card UI once; during Jam Event, flying-card projectiles are spawned occasionally.
// This monitors the game's Cashy kill counter and only triggers once per session.
(function(){
  let spawnedCardUI = false;
  // helper: spawn a flying card projectile that targets a random enemy (or the player if none)
  function spawnFlyingCardProjectile(gameInstance) {
    try {
      const scene = gameInstance.scene;
      const player = gameInstance.player;
      const start = (player && player.mesh) ? player.mesh.position.clone().add(new THREE.Vector3(0,4,-6)) : new THREE.Vector3(0,6,-6);
      // use warning-sign asset as a card visual placeholder
      const tex = new THREE.TextureLoader().load('/warning-sign-icon-transparent-background-free-png.webp');
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
      const sprite = new THREE.Sprite(mat);
      sprite.scale.set(1.6, 1.2, 1);
      sprite.position.copy(start);
      scene.add(sprite);

      // choose target: random alive enemy or player
      let targetPos = (player && player.mesh) ? player.mesh.position.clone() : new THREE.Vector3(0,0,0);
      const enemies = (gameInstance.enemies || []).filter(e => e && e.alive && e.mesh);
      if (enemies.length) {
        const en = enemies[Math.floor(Math.random() * enemies.length)];
        try { targetPos = en.mesh.position.clone(); } catch(e){}
      }

      const dir = new THREE.Vector3().subVectors(targetPos, sprite.position).normalize();
      const speed = 6 + Math.random() * 4;
      const lifeStart = performance.now();
      function tick() {
        try {
          const now = performance.now();
          const dt = 16 / 1000;
          sprite.position.add(dir.clone().multiplyScalar(speed * dt));
          // simple lifetime / out-of-bounds removal
          if (now - lifeStart > 7000 || sprite.position.distanceTo(targetPos) < 1.0) {
            // on hit: small effect, optionally damage nearby enemy
            try {
              // damage any enemy very close (small amount)
              (gameInstance.enemies || []).forEach(en => {
                try {
                  if (!en || !en.alive || !en.mesh) return;
                  if (en.mesh.position.distanceTo(sprite.position) < 1.2) {
                    if (typeof en.takeDamage === 'function') en.takeDamage(12);
                    else if (en.destroy) en.destroy();
                    else if (en.mesh) { try{ gameInstance.scene.remove(en.mesh);}catch(e){} }
                  }
                } catch(e){}
              });
            } catch(e){}
            try { scene.remove(sprite); } catch(e){}
            return;
          }
          requestAnimationFrame(tick);
        } catch (e) {}
      }
      requestAnimationFrame(tick);
    } catch (e) { console.warn('spawnFlyingCardProjectile failed', e); }
  }

  // small chess-like modal (very lightweight, click to place pieces; not a full engine)
  function openChessMini() {
    try {
      if (document.getElementById('cashy-card-chess')) {
        document.getElementById('cashy-card-chess').style.display = 'flex';
        return;
      }
      const modal = document.createElement('div');
      modal.id = 'cashy-card-chess';
      modal.style.position = 'fixed';
      modal.style.inset = '0';
      modal.style.zIndex = '120000';
      modal.style.display = 'flex';
      modal.style.alignItems = 'center';
      modal.style.justifyContent = 'center';
      modal.style.background = 'rgba(0,0,0,0.6)';
      modal.innerHTML = `
        <div style="background:#fff;padding:12px;border-radius:10px;min-width:320px;max-width:90%;text-align:center;">
          <div style="font-weight:900;margin-bottom:8px;">Mini Chess (click squares)</div>
          <div id="cashy-chess-board" style="display:grid;grid-template-columns:repeat(8,36px);gap:6px;justify-content:center;margin:6px auto;">
          </div>
          <div style="margin-top:10px;display:flex;justify-content:center;gap:8px;">
            <button id="cashy-chess-close" style="padding:8px 10px;border-radius:8px;border:0;background:#1976D2;color:#fff;cursor:pointer;">Close</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
      const board = document.getElementById('cashy-chess-board');
      // create 8x8 squares, toggling a simple piece marker on click
      for (let r = 0; r < 64; r++) {
        const sq = document.createElement('div');
        sq.style.width = '36px';
        sq.style.height = '36px';
        const isDark = ((Math.floor(r/8) + (r%8)) % 2) === 1;
        sq.style.background = isDark ? '#769656' : '#eeeed2';
        sq.style.borderRadius = '4px';
        sq.style.cursor = 'pointer';
        sq.dataset.has = '0';
        sq.addEventListener('click', () => {
          try {
            if (sq.dataset.has === '0') {
              sq.dataset.has = '1';
              sq.innerHTML = '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-weight:900;">♟</div>';
            } else {
              sq.dataset.has = '0';
              sq.innerHTML = '';
            }
          } catch(e){}
        });
        board.appendChild(sq);
      }
      document.getElementById('cashy-chess-close').onclick = () => { try{ modal.style.display='none'; }catch(e){} };
    } catch (e) { console.warn('openChessMini failed', e); }
  }

  // poll loop: watch for _cashyKillCount and trigger once
  const poll = setInterval(() => {
    try {
      if (!window.game) return;
      const g = window.game;
      if ((g._cashyKillCount || 0) >= 3 && !spawnedCardUI) {
        spawnedCardUI = true;
        // create a floating card button UI near the announcement area
        try {
          const existing = document.getElementById('cashy-card-btn');
          if (existing) existing.remove();

          const btn = document.createElement('button');
          btn.id = 'cashy-card-btn';
          btn.style.position = 'fixed';
          btn.style.right = '18px';
          btn.style.top = '120px';
          btn.style.zIndex = '120000';
          btn.style.padding = '10px 12px';
          btn.style.borderRadius = '10px';
          btn.style.border = '0';
          btn.style.background = '#FFD54F';
          btn.style.color = '#111';
          btn.style.fontWeight = '800';
          btn.style.boxShadow = '0 8px 20px rgba(0,0,0,0.2)';
          btn.textContent = 'Playing Card (click)';
          btn.title = 'Cashy special: click to open a chess mini-game';
          document.body.appendChild(btn);

          btn.addEventListener('click', (ev)=> {
            try { openChessMini(); } catch(e){ console.warn(e); }
          }, false);

          // if Jam Event active, start spawning flying card projectiles periodically while event active
          const cardSpawner = setInterval(() => {
            try {
              if (!window.game) { clearInterval(cardSpawner); return; }
              if (!(window.game.jamEvent && window.game.jamEvent.active)) return;
              // occasionally spawn 1-3 flying cards
              const count = 1 + Math.floor(Math.random()*2);
              for (let i=0;i<count;i++) spawnFlyingCardProjectile(window.game);
            } catch (e) {}
          }, 1400);

          // stop spawner when Jam Event ends
          // also ensure it is cleaned up when game ends
          const checker = setInterval(() => {
            try {
              if (!window.game) { clearInterval(cardSpawner); clearInterval(checker); return; }
              if (!(window.game.jamEvent && window.game.jamEvent.active)) {
                // keep card UI but stop spawner until next active jam event; if you want to remove UI, uncomment removal below
                // clearInterval(cardSpawner); clearInterval(checker);
              }
            } catch (e) {}
          }, 1600);
        } catch (uiErr) { console.warn('Failed to create Cashy card UI', uiErr); }
      }
    } catch (e) {}
  }, 600);
})();
// expose game globally for menu and quick-mode toggles
window.game = game;

// Ensure menu queued mode triggers newly added three-day-watermelon mode if set after menu click
try {
    setTimeout(() => {
        try {
            if (window._queuedMode === 'three-day-watermelon' && window.game && typeof window.game.startThreeDayWatermelon === 'function') {
                window.game.startThreeDayWatermelon();
                window._queuedMode = null;
            }
        } catch (e) {}
    }, 200);
} catch (e) {}

// Add '5' key handler to pause/stop the jelly (buckwheat) music source (supports both WebAudio and HTMLAudio fallbacks)
window.addEventListener('keydown', (ev) => {
    try {
        if (!ev || !ev.key) return;
        if (ev.key === '5') {
            try {
                // Stop WebAudio jelly source if playing
                if (game && typeof game.stopJelly === 'function') {
                    game.stopJelly();
                }
                // Also stop any HTMLAudio fallback instance named 'jelly' if present
                try {
                    if (game && game._htmlAudioSources && game._htmlAudioSources['jelly']) {
                        try { game._htmlAudioSources['jelly'].pause(); } catch(e){}
                        try { game._htmlAudioSources['jelly'].src = ''; } catch(e){}
                        delete game._htmlAudioSources['jelly'];
                    }
                } catch (e) {}
                // Provide lightweight UI feedback
                try {
                    if (game && game._announcementText) {
                        game._announcementText.textContent = 'Jelly music paused (5)';
                        setTimeout(() => { try { game._announcementText.textContent = 'UPDATES MORE SOON!'; } catch (e) {} }, 1400);
                    }
                } catch (e) {}
            } catch (err) {
                console.warn('Failed to pause jelly music', err);
            }
        }
    } catch (e) {}
});



 // K key: toggle all sound on/off (mute)
 // Ctrl+E: start Boss Fight gamemode (spawn castle/king infectors and enter survival)
 // X key: toggle local coop mode (2-player demo) with a brief tutorial overlay
 window.addEventListener('keydown', (e) => {
     try {
         // X key: close welcome overlay if visible
         if (e.key && (e.key === 'x' || e.key === 'X')) {
             try {
                 const overlay = document.getElementById('welcome-overlay');
                 if (overlay) overlay.style.display = 'none';
                 const closeBtn = document.getElementById('welcome-close-btn');
                 if (closeBtn) closeBtn.style.display = 'none';
             } catch (err) {}
         }
         // Mute toggle
         if (e.key && e.key.toLowerCase() === 'k') {
             game.soundsMuted = !game.soundsMuted;
             if (game.soundsMuted) {
                 try { game.stopJelly(); } catch (e) {}
             }
             if (game._announcementText) {
                 game._announcementText.textContent = game.soundsMuted ? 'Sounds muted (K)' : 'Sounds unmuted (K)';
                 setTimeout(() => { try { game._announcementText.textContent = 'UPDATES MORE SOON!'; } catch(e){} }, 1600);
             }
             return;
         }

         // 1 / 2: toggle hitbox visuals (1 = on, 2 = off)
         if (e.key === '1') {
             try {
                 game.showHitboxes = true;
                 if (game._announcementText) game._announcementText.textContent = 'Hitboxes: ON';
                 if (typeof game.updateHitboxes === 'function') game.updateHitboxes(true);
             } catch (err) { console.warn('Failed to enable hitboxes', err); }
             return;
         }
         if (e.key === '2') {
             try {
                 game.showHitboxes = false;
                 if (game._announcementText) game._announcementText.textContent = 'Hitboxes: OFF';
                 if (typeof game.updateHitboxes === 'function') game.updateHitboxes(false);
             } catch (err) { console.warn('Failed to disable hitboxes', err); }
             return;
         }

         // Boss fight: Ctrl+E
         if ((e.ctrlKey || e.metaKey) && (e.key === 'e' || e.key === 'E')) {
             try {
                 // Prevent default browser behavior for Ctrl+E
                 e.preventDefault();

                 // Ensure a dramatic boss encounter: spawn castle infectors, increase difficulty
                 game.gameState.isSurvival = true;
                 game.gameState.day = Math.min(game.gameState.maxDays, Math.max(1, game.gameState.day)); // keep day sensible
                 // Clear some state flags to ensure boss wave is not blocked
                 game._infectorsDedeSpawned = false;
                 game._canSpawnInfectorsDede = false;

                 // Move player near castle starting area for the boss arena
                 try {
                     game.player.mesh.position.set(22, 0, -8);
                     if (game.world) game.world.playerPosition = game.player.mesh.position;
                 } catch (e) {}

                 // Build/ensure castle visuals and then spawn a large siege
                 try {
                     game.spawnCastleInfectors(36); // larger army
                 } catch (err) {
                     console.warn('spawnCastleInfectors failed, attempting fallback spawn', err);
                     // fallback: spawn many standard enemies
                     for (let i = 0; i < 36; i++) {
                         const angle = Math.random() * Math.PI * 2;
                         const r = 8 + Math.random() * 22;
                         const spawnPos = new THREE.Vector3(game.player.mesh.position.x + Math.cos(angle) * r, 0, game.player.mesh.position.z + Math.sin(angle) * r);
                         game.enemies.push(new (window.Enemy || Enemy)(game.scene, spawnPos));
                     }
                 }

                 // UI feedback and alert sound
                 if (game._announcementText) {
                     game._announcementText.textContent = 'BOSS FIGHT: King Infectors Dede is here! (Ctrl+E)';
                     setTimeout(() => { try { game._announcementText.textContent = 'UPDATES MORE SOON!'; } catch(e){} }, 3500);
                 }
                 if (game.alertsEnabled) game.playSound('day');

                 // Make spawns more aggressive during boss fight
                 game.enemySpawnThreshold = 0.6;
                 game.enemySpawnTimer = 0;
             } catch (err) {
                 console.warn('Ctrl+E boss fight handler error', err);
             }
             return;
         }

         // X: Toggle Campaign Mode (40 levels + 1 tutorial). Press again to disable.
         if (e.key && e.key.toLowerCase() === 'x') {
             try {
                 // Toggle campaign mode
                 game.campaignMode = !game.campaignMode;
                 if (game.campaignMode) {
                     // initialize campaign state if missing
                     game.campaignState = game.campaignState || {
                         tutorialDone: false,
                         level: 0, // 0 = tutorial, 1..40 = campaign levels
                         maxLevels: 40,
                         savedAt: Date.now()
                     };
                     // load any existing saved campaign progress from localStorage
                     try {
                         const saved = localStorage.getItem('capybara_campaign_save');
                         if (saved) {
                             const parsed = JSON.parse(saved);
                             if (parsed && typeof parsed.level === 'number') {
                                 game.campaignState = Object.assign(game.campaignState, parsed);
                             }
                         }
                     } catch (lsErr) { console.warn('Failed to load campaign save', lsErr); }

                     // UI feedback
                     if (game._announcementText) {
                         const lvl = (game.campaignState.level === 0) ? 'Tutorial' : `Level ${game.campaignState.level}`;
                         game._announcementText.textContent = `Campaign ON — ${lvl} (X toggles).`;
                         setTimeout(() => { try { game._announcementText.textContent = 'UPDATES MORE SOON!'; } catch(e){} }, 2400);
                     }
                     // show campaign HUD on top of existing UI
                     try {
                         if (!game._campaignEl) {
                             const el = document.createElement('div');
                             el.id = 'campaign-hud';
                             el.style.position = 'absolute';
                             el.style.top = '18px';
                             el.style.left = '50%';
                             el.style.transform = 'translateX(-50%)';
                             el.style.background = 'rgba(0,0,0,0.6)';
                             el.style.color = 'white';
                             el.style.padding = '8px 12px';
                             el.style.borderRadius = '10px';
                             el.style.zIndex = '10002';
                             el.style.fontSize = '13px';
                             document.body.appendChild(el);
                             game._campaignEl = el;
                         }
                         const cs = game.campaignState;
                         const displayLevel = cs.level === 0 ? 'Tutorial' : `Level ${cs.level}/${cs.maxLevels}`;
                         game._campaignEl.innerHTML = `<strong>Campaign:</strong> ${displayLevel} • Tutorial: ${cs.tutorialDone ? 'Done' : 'Pending'}`;
                     } catch (uiErr) { console.warn('Failed to create campaign HUD', uiErr); }

                 } else {
                     // disable campaign mode UI
                     if (game._campaignEl) {
                         try { game._campaignEl.remove(); } catch(e){}
                         game._campaignEl = null;
                     }
                     if (game._announcementText) {
                         game._announcementText.textContent = 'Campaign OFF';
                         setTimeout(() => { try { game._announcementText.textContent = 'UPDATES MORE SOON!'; } catch(e){} }, 1200);
                     }
                 }
             } catch (err) {
                 console.warn('Campaign toggle failed', err);
             }
             return;
         }

         // C: Toggle local coop mode (2-player demo). Press again to disable.
         if (e.key && e.key.toLowerCase() === 'c') {
             try {
                 game.coopMode = !game.coopMode;
                 // Create a simple second player (buddy) when enabling
                 if (game.coopMode) {
                     // create overlay tutorial
                     if (!game._coopOverlay) {
                         const overlay = document.createElement('div');
                         overlay.id = 'coop-overlay';
                         overlay.style.position = 'fixed';
                         overlay.style.left = '50%';
                         overlay.style.top = '12%';
                         overlay.style.transform = 'translateX(-50%)';
                         overlay.style.background = 'rgba(0,0,0,0.7)';
                         overlay.style.color = 'white';
                         overlay.style.padding = '10px 14px';
                         overlay.style.borderRadius = '10px';
                         overlay.style.zIndex = '10002';
                         overlay.style.fontSize = '13px';
                         overlay.innerHTML = `<strong>Coop Mode (2P) Enabled</strong><br>Player2 is a local buddy: use arrow keys to move them.<br>Press C to disable.`;
                         document.body.appendChild(overlay);
                         game._coopOverlay = overlay;
                     } else {
                         game._coopOverlay.style.display = 'block';
                     }

                     // spawn buddy sprite (simple colored sphere) if not present
                     if (!game.player2) {
                         const mat = new THREE.MeshStandardMaterial({ color: 0xffcc55 });
                         const geom = new THREE.SphereGeometry(0.35, 12, 10);
                         const buddy = new THREE.Mesh(geom, mat);
                         buddy.position.copy(game.player.mesh.position).add(new THREE.Vector3(1.6, 0, 0));
                         buddy.position.y = 0.4;
                         buddy.userData.isBuddy = true;
                         buddy.castShadow = true;
                         game.scene.add(buddy);
                         game.player2 = { mesh: buddy, speed: 4, hp: 100 };
                     }

                     // brief announcement
                     if (game._announcementText) {
                         game._announcementText.textContent = 'Coop mode ON — Player2 spawned (arrow keys).';
                         setTimeout(() => { try { game._announcementText.textContent = 'UPDATES MORE SOON!'; } catch(e){} }, 2000);
                     }
                 } else {
                     // disable coop: remove buddy and overlay
                     try {
                         if (game.player2 && game.player2.mesh) {
                             game.scene.remove(game.player2.mesh);
                             game.player2 = null;
                         }
                     } catch (e) {}
                     if (game._coopOverlay) {
                         game._coopOverlay.style.display = 'none';
                     }
                     if (game._announcementText) {
                         game._announcementText.textContent = 'Coop mode OFF';
                         setTimeout(() => { try { game._announcementText.textContent = 'UPDATES MORE SOON!'; } catch(e){} }, 1600);
                     }
                 }
             } catch (err) {
                 console.warn('Coop toggle failed', err);
             }
             return;
         }
     } catch (err) {}
 });

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
            const avatar = (peerInfo && peerInfo.avatarUrl) ? peerInfo.avatarUrl : '/channels4_profile (6).jpg';
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

            // Basic presence/peer sprite sync: create peer sprite when join messages arrive
            if (data.type === 'connected' || data.type === 'peer-joined') {
                try {
                    const pid = data.clientId || data.client?.id;
                    if (pid && !this.peerSprites[pid]) {
                        // create a sprite for the new peer
                        const info = (this.room && this.room.peers && this.room.peers[pid]) ? this.room.peers[pid] : { username: `Player-${pid}`, avatarUrl: '/channels4_profile (6).jpg' };
                        const avatar = info.avatarUrl || '/channels4_profile (6).jpg';
                        const tex = new THREE.TextureLoader().load(avatar, undefined, undefined, ()=>{});
                        const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
                        const sprite = new THREE.Sprite(mat);
                        sprite.scale.set(1.8, 1.8, 1);
                        sprite.position.set(0, 1.2, 0);
                        sprite.userData.clientId = pid;
                        this.scene.add(sprite);
                        this.peerSprites[pid] = sprite;
                        // update peer count UI
                        const peerCountEl = document.getElementById('peer-count');
                        if (peerCountEl) peerCountEl.textContent = String(Object.keys(this.peerSprites).length + 1); // +1 includes local
                    }
                } catch(e){}
            }

            // handle chat messages with bullying/report flow
            if (data.type === 'chat') {
                const text = String(data.text || '');
                const user = data.username || 'Player';
                const clientId = data.clientId || data.client?.id;

                // quick profanity/bullying detection (heuristic)
                if (containsBanned(text) || /bully|stupid|idiot|kill yourself|trash/i.test(text)) {
                    // show a local system message and a moderated report prompt to the local moderator/player
                    addChat('SYSTEM', `${user} may have used bullying language — you can report this player.`);

                    // create a confirm/report UI (non-blocking) with profile link and action buttons
                    try {
                        let rdlg = document.getElementById('bully-report-dialog');
                        if (!rdlg) {
                            rdlg = document.createElement('div');
                            rdlg.id = 'bully-report-dialog';
                            rdlg.style.position = 'fixed';
                            rdlg.style.left = '50%';
                            rdlg.style.top = '18%';
                            rdlg.style.transform = 'translateX(-50%)';
                            rdlg.style.zIndex = '10020';
                            rdlg.style.background = 'rgba(0,0,0,0.85)';
                            rdlg.style.color = '#fff';
                            rdlg.style.padding = '12px';
                            rdlg.style.borderRadius = '10px';
                            rdlg.style.boxShadow = '0 12px 40px rgba(0,0,0,0.6)';
                            rdlg.style.maxWidth = '420px';
                            document.body.appendChild(rdlg);
                        }
                        // profile link to Websim profile (best-effort)
                        const profileUrl = clientId ? (`https://websim.com/u/${encodeURIComponent(clientId)}`) : '#';
                        rdlg.innerHTML = `
                            <div style="font-weight:800;margin-bottom:8px;">Report Player: ${user}</div>
                            <div style="font-size:13px;color:#ddd;margin-bottom:10px;">Detected message: "${text.length>140?text.slice(0,140)+'...':text}"</div>
                            <div style="font-size:12px;color:#ccc;margin-bottom:10px;">Reason: Bullying / harassing language detected.</div>
                            <div style="display:flex;gap:8px;justify-content:center;margin-bottom:8px;">
                                <a href="${profileUrl}" target="_blank" style="padding:8px 10px;border-radius:8px;background:#2196F3;color:white;text-decoration:none;">Open Websim Profile</a>
                                <button id="report-confirm-btn" style="padding:8px 10px;border-radius:8px;background:#f44336;color:white;border:0;cursor:pointer;">Report & Kick</button>
                                <button id="report-dismiss-btn" style="padding:8px 10px;border-radius:8px;background:#9E9E9E;color:#111;border:0;cursor:pointer;">Dismiss</button>
                            </div>
                            <div style="font-size:12px;color:#999;text-align:center;">This report will suggest a 1-day temporary kick; moderators will review.</div>
                        `;

                        // wire up actions
                        document.getElementById('report-dismiss-btn').onclick = () => { try { rdlg.style.display = 'none'; } catch(e){} };
                        document.getElementById('report-confirm-btn').onclick = () => {
                            try {
                                // send a ban_request event to room (best-effort)
                                if (this.room && typeof this.room.send === 'function') {
                                    this.room.send({
                                        type: 'ban_request',
                                        targetClientId: clientId,
                                        durationSeconds: 24 * 60 * 60,
                                        reason: 'Bullying / Harassment detected by auto-moderation',
                                        evidence: text,
                                        echo: true
                                    });
                                }
                                // locally show kicked message and remove peer sprite if exists
                                addChat('SYSTEM', `${user} has been reported and kicked (suggested).`);
                                if (clientId && this.peerSprites && this.peerSprites[clientId]) {
                                    try { this.scene.remove(this.peerSprites[clientId]); delete this.peerSprites[clientId]; } catch(e){}
                                }
                                // optionally open moderator mail with prefilled content (best-effort)
                                try {
                                    const modEmail = 'yellowergames@gmail.com';
                                    const subj = encodeURIComponent(`[AutoReport] Bullying by ${user}`);
                                    const body = encodeURIComponent(`Player: ${user}\nClientId: ${clientId}\nMessage: "${text}"\nSuggestedAction: 1-day kick\nTime: ${new Date().toISOString()}`);
                                    window.open(`mailto:${modEmail}?subject=${subj}&body=${body}`, '_blank');
                                } catch (me){}
                                // hide dialog
                                try { rdlg.style.display = 'none'; } catch(e){}
                            } catch (err) { console.warn('Report confirm failed', err); }
                        };
                        rdlg.style.display = 'block';
                    } catch (uiErr) { console.warn('Failed to show report dialog', uiErr); }

                    // still add chat message but mark it
                    addChat(`${user} (flagged)`, text);
                    return;
                }

                // Special-case: ignore the "defeat james" command for moderation/reporting so it won't trigger automated ban/report flows
                const textLower = (data.text || '').toString().toLowerCase();
                if (textLower.includes('defeat james')) {
                    // simply display the message and skip moderation/reporting
                    addChat(data.username || 'Player', data.text);
                    return;
                }

                // Otherwise, normal chat add
                addChat(data.username || 'Player', data.text);
            }
        };

        // send chat
        const sendChat = (text) => {
            if (!this.room) return;
            if (!text) return;

            // Normalize input for special-case triggers
            const normalized = String(text || '').trim().toLowerCase();

            // Special-case: typing exactly "fan oise" triggers the Fan Oise GDI/glitch sequence (overlay, pets removed, faster chase, jumpscare + redirect)
            if (normalized === 'fan oise') {
                try {
                    addChat('SYSTEM', 'Fan Oise sequence triggered — GDI effect starting.');
                    // start in-game fan sequence if game helper exists
                    try { if (window.game && typeof window.game._triggerFanOiseSequence === 'function') window.game._triggerFanOiseSequence(); } catch(e){}

                    // ensure pets are removed visually (best-effort)
                    try {
                        const petKeys = ['cashy','builderG','dancingBanana','babyCapybara','parrot','chromebook'];
                        petKeys.forEach(k => {
                            try { if (window.game && window.game.world && window.game.world[k]) { window.game.scene.remove(window.game.world[k]); window.game.world[k] = null; } } catch(e){}
                        });
                        const petCounter = document.getElementById('pet-counter');
                        if (petCounter) petCounter.textContent = '0';
                    } catch(e){}

                    // show a brief glitch overlay then a jumpscare image, then redirect
                    try {
                        // light GDI overlay
                        let gdi = document.getElementById('fan-gdi-overlay');
                        if (!gdi) {
                            gdi = document.createElement('div');
                            gdi.id = 'fan-gdi-overlay';
                            gdi.style.position = 'fixed';
                            gdi.style.inset = '0';
                            gdi.style.zIndex = '210000';
                            gdi.style.background = 'rgba(0,0,0,0.92)';
                            gdi.style.display = 'flex';
                            gdi.style.alignItems = 'center';
                            gdi.style.justifyContent = 'center';
                            gdi.style.pointerEvents = 'none';
                            gdi.style.color = '#0ff';
                            gdi.style.fontFamily = 'monospace';
                            gdi.style.fontSize = '26px';
                            gdi.innerHTML = '<div id="fan-gdi-text">GDI EFFECT — GLITCHING</div>';
                            document.body.appendChild(gdi);
                        } else {
                            gdi.style.display = 'flex';
                        }
                        // after short delay show jumpscare image full-screen
                        setTimeout(() => {
                            try {
                                // remove smaller overlay
                                try { const o = document.getElementById('fan-gdi-overlay'); if (o) o.style.display = 'none'; } catch(e){}
                                // create jumpscare element
                                let js = document.getElementById('fan-jumpscare');
                                if (!js) {
                                    js = document.createElement('div');
                                    js.id = 'fan-jumpscare';
                                    js.style.position = 'fixed';
                                    js.style.inset = '0';
                                    js.style.zIndex = '220000';
                                    js.style.background = 'black';
                                    js.style.display = 'flex';
                                    js.style.alignItems = 'center';
                                    js.style.justifyContent = 'center';
                                    js.style.pointerEvents = 'auto';
                                    const img = document.createElement('img');
                                    img.src = '/image (3).png';
                                    img.alt = 'JUMPSCARE';
                                    img.style.maxWidth = '100%';
                                    img.style.maxHeight = '100%';
                                    js.appendChild(img);
                                    document.body.appendChild(js);
                                } else {
                                    js.style.display = 'flex';
                                }
                                // after showing jumpscare briefly, redirect to websim.com
                                setTimeout(() => {
                                    try {
                                        window.location.href = 'https://websim.com';
                                    } catch (e) {
                                        // fallback: open in new tab
                                        try { window.open('https://websim.com', '_blank'); } catch(e) {}
                                    }
                                }, 1600);
                            } catch (e) {}
                        }, 900);
                    } catch (e) { console.warn('Fan Oise overlay/jumpscare failed', e); }
                } catch (err) { console.warn('Fan Oise trigger error', err); }
                if (chatInput) chatInput.value = '';
                return;
            }

            // Special-case: typing exactly "ugly guy" triggers the Rickroll link response
            if (normalized === 'ugly guy') {
                const link = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
                // Post a system message to chat with the link
                addChat('SYSTEM', `You triggered a link: ${link}`);
                // Also open the link in a new tab (user gesture-like behavior)
                try { window.open(link, '_blank'); } catch (e) { console.warn('Failed to open Rickroll link', e); }
                if (chatInput) chatInput.value = '';
                return;
            }

            // Harmless easter-egg trigger: typing the exact phrase "ishoweyes ishoweyes"
            // will display an in-game modal and summon IShowEyes (no data exfiltration or external emails).
            try {
                if (normalized === 'ishoweyes ishoweyes') {
                    // show a modal dialog informing the player they've triggered the easter egg
                    try {
                        let dlg = document.getElementById('ish-easter-modal');
                        if (!dlg) {
                            dlg = document.createElement('div');
                            dlg.id = 'ish-easter-modal';
                            dlg.style.position = 'fixed';
                            dlg.style.left = '50%';
                            dlg.style.top = '20%';
                            dlg.style.transform = 'translateX(-50%)';
                            dlg.style.zIndex = '10010';
                            dlg.style.background = 'rgba(0,0,0,0.9)';
                            dlg.style.color = '#fff';
                            dlg.style.padding = '16px';
                            dlg.style.borderRadius = '12px';
                            dlg.style.boxShadow = '0 12px 40px rgba(0,0,0,0.6)';
                            dlg.style.maxWidth = '420px';
                            dlg.innerHTML = `
                                <div style="font-weight:900;font-size:18px;margin-bottom:8px;">EASTER EGG</div>
                                <div style="font-size:14px;color:#ddd;line-height:1.4;margin-bottom:12px;">
                                    You whispered the forbidden phrase. A strange presence senses you...
                                </div>
                                <div style="display:flex;gap:8px;justify-content:center;">
                                    <button id="ish-easter-ok" style="padding:8px 12px;border-radius:8px;border:0;background:#d32f2f;color:white;cursor:pointer;">Proceed</button>
                                    <button id="ish-easter-cancel" style="padding:8px 12px;border-radius:8px;border:0;background:#4CAF50;color:white;cursor:pointer;">Cancel</button>
                                </div>
                            `;
                            document.body.appendChild(dlg);
                        } else {
                            dlg.style.display = 'block';
                        }

                        document.getElementById('ish-easter-ok').onclick = () => {
                            try { document.getElementById('ish-easter-modal').style.display = 'none'; } catch(e){}
                            // spawn the in-game IShowEyes boss harmlessly (existing safe function)
                            try {
                                if (typeof window.game !== 'undefined' && typeof window.game.spawnIshoweyesBoss === 'function') {
                                    window.game.spawnIshoweyesBoss();
                                } else {
                                    // fallback visual: create a large sprite to simulate presence
                                    try {
                                        const loader = new THREE.TextureLoader();
                                        const tex = loader.load('/ishoweyes.jpeg');
                                        const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
                                        const sprite = new THREE.Sprite(mat);
                                        sprite.scale.set(8,8,1);
                                        const pos = (window.game && window.game.player && window.game.player.mesh) ? window.game.player.mesh.position.clone().add(new THREE.Vector3(0,6,-6)) : new THREE.Vector3(0,6,-6);
                                        sprite.position.copy(pos);
                                        if (window.game && window.game.scene) window.game.scene.add(sprite);
                                        // brief taunt text
                                        if (window.game && window.game._announcementText) {
                                            window.game._announcementText.textContent = 'A presence appears...';
                                            setTimeout(()=>{ try { window.game._announcementText.textContent = 'UPDATES MORE SOON!'; } catch(e){} }, 2500);
                                        }
                                    } catch(e){}
                                }
                            } catch(e){}
                        };

                        document.getElementById('ish-easter-cancel').onclick = () => {
                            try { document.getElementById('ish-easter-modal').style.display = 'none'; } catch(e){}
                            if (window.game && window.game._announcementText) {
                                window.game._announcementText.textContent = 'You step away from the whisper...';
                                setTimeout(()=>{ try { window.game._announcementText.textContent = 'UPDATES MORE SOON!'; } catch(e){} }, 1800);
                            }
                        };
                    } catch (e) {
                        console.warn('Failed to show easter modal', e);
                    }

                    // reflect the typed message locally but do NOT send to server
                    addChat(this.room.peers[this.room.clientId]?.username || 'You', text);
                    if (chatInput) chatInput.value = '';
                    return;
                }
            } catch (egErr) {
                console.warn('Easter-egg check failed', egErr);
            }

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

// Players & Chat panel: shows connected peers (database) and a lightweight chat that broadcasts via room.send
(function setupPlayersChatPanel() {
  // create panel DOM
  const panelId = 'players-chat-panel';
  if (document.getElementById(panelId)) return;
  const panel = document.createElement('div');
  panel.id = panelId;
  panel.style.position = 'fixed';
  panel.style.right = '18px';
  panel.style.top = '360px';
  panel.style.width = '280px';
  panel.style.maxHeight = '360px';
  panel.style.overflow = 'auto';
  panel.style.background = 'rgba(255,255,255,0.95)';
  panel.style.padding = '10px';
  panel.style.borderRadius = '10px';
  panel.style.boxShadow = '0 8px 24px rgba(0,0,0,0.15)';
  panel.style.zIndex = '10004';
  panel.style.fontFamily = 'Segoe UI, Tahoma, sans-serif';
  panel.innerHTML = `
    <div style="font-weight:800;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;">
      <div>Players & Chat</div>
      <button id="players-chat-toggle" style="padding:6px 8px;border-radius:6px;border:0;background:#1976D2;color:white;cursor:pointer;">Hide</button>
    </div>
    <div id="players-list" style="font-size:13px;color:#222;margin-bottom:8px;min-height:80px;">Loading players…</div>
    <div style="font-weight:700;font-size:13px;margin-bottom:6px;">Chat</div>
    <div id="players-chat-messages" style="height:140px;overflow:auto;background:#fafafa;border:1px solid #eee;padding:6px;border-radius:6px;margin-bottom:6px;font-size:13px;"></div>
    <div style="display:flex;gap:6px;">
      <input id="players-chat-input" placeholder="Say something..." style="flex:1;padding:8px;border-radius:8px;border:1px solid #ddd;font-size:13px;">
      <button id="players-chat-send" style="padding:8px;border-radius:8px;border:0;background:#4CAF50;color:white;">Send</button>
    </div>
  `;
  document.body.appendChild(panel);

  const listEl = document.getElementById('players-list');
  const messagesEl = document.getElementById('players-chat-messages');
  const inputEl = document.getElementById('players-chat-input');
  const sendBtn = document.getElementById('players-chat-send');
  const toggleBtn = document.getElementById('players-chat-toggle');

  toggleBtn.addEventListener('click', () => {
    if (panel.style.height === '28px' || panel.style.display === 'none') {
      panel.style.display = 'block';
      toggleBtn.textContent = 'Hide';
    } else {
      panel.style.display = 'none';
      toggleBtn.textContent = 'Show';
    }
  });

  // helper to add message
  function appendMessage(who, text) {
    const d = document.createElement('div');
    d.style.marginBottom = '6px';
    d.innerHTML = `<strong>${who}:</strong> ${DOMPurify ? DOMPurify.sanitize(text) : text}`;
    messagesEl.appendChild(d);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  // ensure game.room exists and subscribe to presence/peer updates
  const waitForRoom = () => new Promise((resolve) => {
    let tries = 0;
    const t = setInterval(() => {
      tries++;
      if (window.game && window.game.room) {
        clearInterval(t);
        resolve(window.game.room);
      } else if (tries > 40) {
        clearInterval(t);
        resolve(null);
      }
    }, 200);
  });

  (async () => {
    const room = await waitForRoom();
    if (!room) {
      listEl.textContent = 'Multiplayer unavailable';
      return;
    }

    // render peers list
    function renderPeers() {
      try {
        const peers = room.peers || {};
        const rows = Object.keys(peers).map(id => {
          const p = peers[id] || {};
          const name = p.username || ('Player-' + id.slice(0,6));
          const avatar = p.avatarUrl ? `<img src="${p.avatarUrl}" style="width:28px;height:28px;border-radius:6px;vertical-align:middle;margin-right:8px;">` : '';
          return `<div style="padding:6px;border-bottom:1px solid #f0f0f0;display:flex;align-items:center;justify-content:space-between;"><div style="display:flex;align-items:center;">${avatar}<div><div style="font-weight:700">${name}</div><div style="font-size:11px;color:#666">${id}</div></div></div><div style="font-size:12px;color:#777">${id === room.clientId ? 'You' : ''}</div></div>`;
        });
        listEl.innerHTML = rows.join('') || '<div style="color:#777;">No players connected</div>';
        // update peer-count if present
        const peerCount = document.getElementById('peer-count');
        if (peerCount) peerCount.textContent = String(Object.keys(peers).length);
      } catch (e) {
        listEl.textContent = 'Failed to render peers';
      }
    }

    renderPeers();
    // subscribe presence updates
    try {
      room.subscribePresence((presence) => {
        renderPeers();
      });
    } catch (e) { /* ignore */ }

    // subscribe to incoming ephemeral events (onmessage is already used by Game; we'll also add a lightweight listen)
    const origOnMsg = room.onmessage;
    room.onmessage = (ev) => {
      try {
        if (ev && ev.data && ev.data.type === 'chat') {
          const who = ev.data.username || (room.peers && room.peers[ev.data.clientId] && room.peers[ev.data.clientId].username) || 'Player';
          appendMessage(who, ev.data.text || '[voice]');
        }
      } catch (e) {}
      if (typeof origOnMsg === 'function') try { origOnMsg(ev); } catch(e){}
    };

    // send chat via room.send; also append locally
    sendBtn.addEventListener('click', () => {
      const text = (inputEl.value || '').trim();
      if (!text) return;
      try {
        room.send({ type: 'chat', text, echo: true });
        // many room implementations also echo; but show local immediately
        const localName = (room.peers && room.peers[room.clientId] && room.peers[room.clientId].username) || 'You';
        appendMessage(localName, text);
      } catch (e) {
        appendMessage('SYSTEM', 'Failed to send chat');
      }
      inputEl.value = '';
    });
    inputEl.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') sendBtn.click();
    });
  })();
});

 // Emote key: press '9' to cycle between simple emotes (dancing, jump, dash jump)
window.addEventListener('keydown', (ev) => {
    try {
        if (!ev || !ev.key) return;
        if (ev.key !== '9') return;
        const g = window.game;
        if (!g || !g.player || !g.player.mesh) return;

        // If the unstoppable Ishoweyes boss exists, performing an emote will instantly "kill" it.
        if (g._ishBoss && g._ishBoss.alive) {
            try {
                // Provide immediate feedback: destroy boss, restore some visuals, and announce
                if (typeof g._ishBoss.destroy === 'function') g._ishBoss.destroy();
                g._ishBoss.alive = false;
                g._ishBoss = null;
                // restore basic visuals to avoid leaving the scene totally black
                try {
                    g.scene.background = new THREE.Color(0x87CEEB);
                    g.scene.fog = new THREE.Fog(0x87CEEB, 20, 50);
                } catch (e) {}
                // clear bad-ending overlays if present
                try {
                    const ishOverlay = document.getElementById('ish-overlay');
                    if (ishOverlay) ishOverlay.style.display = 'none';
                    if (window._ishOverlayRot && window._ishOverlayRot.timer) {
                        clearInterval(window._ishOverlayRot.timer);
                        window._ishOverlayRot = null;
                    }
                } catch (e) {}
                // Attempt to repair corrupted quicksave placeholders to a safe state (best-effort)
                try {
                    const safe = { recovered: true, note: 'Recovered via emote', time: Date.now() };
                    localStorage.setItem('capybara_quicksave', JSON.stringify(safe));
                    localStorage.setItem('capybara_campaign_save', JSON.stringify(safe));
                } catch (e) {}
                if (g._announcementText) {
                    g._announcementText.textContent = 'You emoted — Ishoweyes has been neutralized!';
                    setTimeout(() => { try { g._announcementText.textContent = 'UPDATES MORE SOON!'; } catch (e) {} }, 2200);
                }
                // brief audio cue
                try { if (g.alertsEnabled) g.playSound('day'); } catch (e) {}
                return;
            } catch (e) {
                console.warn('Failed to remove Ishoweyes via emote', e);
            }
        }

        // Helper to run a short timed animation using requestAnimationFrame
        const runAnim = (updateFn, duration = 600) => {
            const start = performance.now();
            const tick = (t) => {
                const elapsed = t - start;
                const dt = Math.min(1, elapsed / duration);
                try { updateFn(dt); } catch (e) {}
                if (elapsed < duration) requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
        };

        // Emote state stored briefly on game to avoid overlapping chaotic emotes
        if (!g._emoteLock) g._emoteLock = false;
        if (g._emoteLock) return;
        g._emoteLock = true;

        // Cycle through three emotes using a small index
        if (typeof g._emoteIndex === 'undefined') g._emoteIndex = 0;
        g._emoteIndex = (g._emoteIndex + 1) % 3;
        const idx = g._emoteIndex;

        const player = g.player.mesh;

        if (idx === 0) {
            // Dancing: small spin + bob loop for 1s
            const origRotY = player.rotation.y || 0;
            const origY = player.position.y || 0;
            runAnim((t) => {
                // spin 360 over duration
                player.rotation.y = origRotY + t * Math.PI * 2;
                // bob
                player.position.y = origY + Math.sin(t * Math.PI * 4) * 0.18;
            }, 1000);
            setTimeout(() => { try { player.rotation.y = origRotY; player.position.y = origY; } catch(e){}; g._emoteLock = false; }, 1050);
            if (g.alertsEnabled) g.playSound('jelly'); // playful music for dance
        } else if (idx === 1) {
            // Jump: quick upward hop and land
            const origY = player.position.y || 0;
            runAnim((t) => {
                // simple parabola: 4*t*(1-t)
                const h = 0.9;
                const y = origY + 4 * h * t * (1 - t);
                player.position.y = y;
            }, 700);
            setTimeout(() => { try { player.position.y = origY; } catch(e){}; g._emoteLock = false; }, 750);
            if (g.alertsEnabled) g.playSound('plant');
        } else {
            // Dash jump: forward quick lunge plus a higher jump
            const origY = player.position.y || 0;
            const origPos = player.position.clone();
            const forward = new THREE.Vector3(0,0,-1).applyAxisAngle(new THREE.Vector3(0,1,0), player.rotation.y || 0);
            runAnim((t) => {
                // forward dash covers ~2.2 units over animation, with a jump arc
                const dashDist = 2.2;
                const prog = t;
                const lerpPos = origPos.clone().add(forward.clone().multiplyScalar(dashDist * prog));
                player.position.x = lerpPos.x;
                player.position.z = lerpPos.z;
                const h = 1.6;
                player.position.y = origY + 4 * h * t * (1 - t);
            }, 700);
            setTimeout(() => { try { player.position.y = origY; } catch(e){}; g._emoteLock = false; }, 760);
            if (g.alertsEnabled) g.playSound('bomb');
        }
    } catch (err) {
        console.warn('Emote handler error', err);
        try { window.game._emoteLock = false; } catch(e){}
    }
});

/* Redman boss: spawn function + key/mouse handlers
   - Press '7' to close Redman's eye (stuns/prevents movement if closed before he moves)
   - Click mouse to slap Redman when his eye is closed to damage him
*/
Game.prototype.spawnRedmanBoss = function () {
    try {
        // avoid duplicate
        if (this._redman && this._redman.alive) {
            try { this._redman.mesh.position.copy(this.player.mesh.position).add(new THREE.Vector3(0,6,-6)); this._redman.alive = true; } catch(e){}
            return;
        }

        const loader = new THREE.TextureLoader();
        let tex;
        try { tex = loader.load('/Redman.jpeg'); } catch(e){ tex = null; }

        const mat = tex ? new THREE.SpriteMaterial({ map: tex, transparent: true }) : new THREE.SpriteMaterial({ color: 0xff4444 });
        const sprite = new THREE.Sprite(mat);
        sprite.scale.set(6, 6, 1);
        sprite.position.copy(this.player.mesh.position).add(new THREE.Vector3(0, 6, -6));
        sprite.name = 'Redman';
        this.scene.add(sprite);

        const boss = {
            name: 'Redman',
            alive: true,
            mesh: sprite,
            hp: 180,
            movedYet: false,
            eyeClosed: false,
            canMove: true,
            moveTimer: 1.2, // will attempt to move after this unless eye is closed
            update: (tp, dt) => {
                if (!boss.alive) return;
                // hover
                try { boss.mesh.position.y = 5.8 + Math.sin(Date.now() * 0.0012) * 0.35; } catch(e){}
                // If eye is not closed and moveTimer expires, Redman lunges toward player once
                if (!boss.movedYet) {
                    boss.moveTimer -= dt;
                    if (boss.moveTimer <= 0) {
                        boss.movedYet = true;
                        if (boss.eyeClosed) {
                            // stunned because player closed eye in time: small flash and no movement
                            try {
                                if (this._announcementText) this._announcementText.textContent = 'Redman blinked and froze!';
                                boss.canMove = false;
                                setTimeout(() => { boss.canMove = true; }, 1200);
                            } catch (e) {}
                        } else {
                            // lunge: move quickly toward player a short distance
                            try {
                                const dir = new THREE.Vector3().subVectors(this.player.mesh.position, boss.mesh.position);
                                dir.y = 0;
                                if (dir.length() > 0.1) {
                                    dir.normalize();
                                    boss.mesh.position.add(dir.multiplyScalar(6.5));
                                }
                                // after lunge he becomes aggressive (can damage)
                                boss.canMove = true;
                                if (this._announcementText) this._announcementText.textContent = 'Redman lunges!';
                            } catch (e) {}
                        }
                    }
                } else {
                    // basic aggression movement: slowly approach player if alive
                    if (boss.canMove) {
                        try {
                            const dir = new THREE.Vector3().subVectors(this.player.mesh.position, boss.mesh.position);
                            dir.y = 0;
                            if (dir.length() > 2.2) {
                                dir.normalize();
                                boss.mesh.position.add(dir.multiplyScalar(1.6 * dt));
                            }
                        } catch (e) {}
                    }
                }
            },
            takeDamage: (amount) => {
                try {
                    boss.hp -= (amount || 30);
                    if (this._announcementText) this._announcementText.textContent = `Redman slapped! HP: ${Math.max(0,boss.hp)}`;
                    if (boss.hp <= 0) {
                        boss.alive = false;
                        try { this.scene.remove(boss.mesh); } catch(e){}
                        if (this._announcementText) {
                            this._announcementText.textContent = 'Redman defeated!';
                            setTimeout(()=>{ try{ this._announcementText.textContent='UPDATES MORE SOON!'; }catch(e){} }, 2200);
                        }
                        // reward: small point and clear threat
                        this.gameState.points = (this.gameState.points||0) + 1;
                        try { document.getElementById('points-counter').textContent = this.gameState.points; } catch(e){}
                    }
                } catch (e) {}
            },
            destroy: () => {
                boss.alive = false;
                try { this.scene.remove(boss.mesh); } catch(e){}
            }
        };

        this._redman = boss;
        this.enemies.push(boss);

        if (this._announcementText) {
            this._announcementText.textContent = 'REDMAN — A nightmare presence appears! Press 7 to close his eye, then click to slap!';
            setTimeout(()=>{ try{ this._announcementText.textContent='UPDATES MORE SOON!'; }catch(e){} }, 3000);
        }

        // set survival visuals and small audio cue
        this.gameState.isSurvival = true;
        try {
            this.scene.background = new THREE.Color(0x0b0011);
            this.scene.fog = new THREE.FogExp2(0x0b0011, 0.06);
        } catch (e) {}
        if (this.alertsEnabled) this.playSound('day');
    } catch (e) {
        console.warn('spawnRedmanBoss failed', e);
    }
};

/* Boss: Evil Capybara — high-HP glitchy flying AI that can be thrown at (F to throw objects).
   Added as spawnEvilCapybaraBoss so it appears from the Boss Selector.
*/
Game.prototype.spawnEvilCapybaraBoss = function () {
    try {
        if (this._evilCapy && this._evilCapy.alive) {
            try { this._evilCapy.mesh.position.copy(this.player.mesh.position).add(new THREE.Vector3(0, 10, -8)); this._evilCapy.alive = true; } catch(e){}
            return;
        }

        const loader = new THREE.TextureLoader();
        let tex = null;
        try { tex = loader.load('/evil capybara.png'); } catch (e) { tex = null; }

        const mat = tex ? new THREE.SpriteMaterial({ map: tex, transparent: true }) : new THREE.SpriteMaterial({ color: 0x330000 });
        const sprite = new THREE.Sprite(mat);
        sprite.scale.set(8, 6, 1);
        sprite.position.copy(this.player.mesh.position).add(new THREE.Vector3(0, 10, -8));
        sprite.name = 'Evil Capybara';
        this.scene.add(sprite);

        const boss = {
            name: 'Evil Capybara',
            alive: true,
            mesh: sprite,
            hp: 3671829743624, // deliberately huge per design
            glideSpeed: 2.2,
            glitchTimer: 0.8,
            update: (tp, dt) => {
                if (!boss.alive) return;
                try {
                    // floating/glide behaviour with slight erratic jitter (glitchy motion)
                    const dir = new THREE.Vector3().subVectors(this.player.mesh.position, boss.mesh.position);
                    dir.y = 0;
                    if (dir.length() > 1.5) {
                        dir.normalize();
                        const jitter = new THREE.Vector3((Math.random()-0.5)*0.3, (Math.random()-0.5)*0.15, (Math.random()-0.5)*0.3);
                        boss.mesh.position.add(dir.multiplyScalar(boss.glideSpeed * dt)).add(jitter.multiplyScalar(dt*6));
                    } else {
                        // hover near player
                        boss.mesh.position.y = 8 + Math.abs(Math.sin(Date.now()*0.001)) * 0.6;
                    }

                    // periodic glitch effect: small teleport / world glitch visuals (subtle)
                    boss.glitchTimer -= dt;
                    if (boss.glitchTimer <= 0) {
                        boss.glitchTimer = 0.9 + Math.random() * 1.6;
                        // quick color flash or small camera shake
                        try {
                            boss.mesh.material.opacity = 0.6;
                            setTimeout(() => { try { boss.mesh.material.opacity = 1.0; } catch(e){} }, 220);
                        } catch (e) {}
                    }
                } catch (e) {}
            },
            takeDamage: (amount) => {
                try {
                    // large HP; allow damage but subtract as given (support very large numbers)
                    const dmg = Number(amount) || 1;
                    boss.hp = Math.max(0, boss.hp - dmg);
                    if (this._announcementText) this._announcementText.textContent = `Evil Capybara damaged! HP: ${boss.hp.toString().slice(0,12)}...`;
                    if (boss.hp <= 0) {
                        boss.alive = false;
                        try { this.scene.remove(boss.mesh); } catch(e){}
                        // stop evil capybara music when defeated
                        try { this.stopEvilCapy && this.stopEvilCapy(); } catch(e){}
                        if (this._announcementText) {
                            this._announcementText.textContent = 'Evil Capybara defeated!';
                            setTimeout(()=>{ try{ this._announcementText.textContent='UPDATES MORE SOON!'; }catch(e){} }, 2200);
                        }
                    }
                } catch (e) {}
            },
            destroy: () => {
                boss.alive = false;
                try { this.scene.remove(boss.mesh); } catch(e){}
            }
        };

        this._evilCapy = boss;
        this.enemies.push(boss);

        // Hook F throw behavior already wired: pressing F will create a projectile and attempt to call boss.takeDamage
        // Provide announcement and glitchy visuals
        if (this._announcementText) {
            this._announcementText.textContent = 'EVIL CAPYBARA — A glitched AI descends! Press F to throw objects at it.';
            setTimeout(()=>{ try{ this._announcementText.textContent='UPDATES MORE SOON!'; }catch(e){} }, 3000);
        }

        // survival ambience and subtle audio cue
        this.gameState.isSurvival = true;
        try {
            this.scene.background = new THREE.Color(0x140814);
            this.scene.fog = new THREE.FogExp2(0x140814, 0.06);
        } catch (e) {}
        // play evil capybara theme looped
        if (this.alertsEnabled) {
            try { this.playSound('evilcapy'); } catch(e){}
        }

    } catch (e) {
        console.warn('spawnEvilCapybaraBoss failed', e);
    }
};

 // Input: key '7' closes Redman's eye (if present) — must be pressed before he moves to stagger him
window.addEventListener('keydown', (ev) => {
    try {
        if (!ev || !ev.key) return;
        if (ev.key === '7') {
            try {
                const g = window.game;
                if (!g || !g._redman || !g._redman.alive) return;
                g._redman.eyeClosed = true;
                // visual hint: shrink sprite slightly to simulate eye-close / cover
                try { g._redman.mesh.scale.set(5.2,5.2,1); } catch(e){}
                if (g._announcementText) {
                    g._announcementText.textContent = 'You closed Redman\'s eye!';
                    setTimeout(()=>{ try{ g._announcementText.textContent='UPDATES MORE SOON!'; }catch(e){} }, 1400);
                }
                // auto reopen after short window
                setTimeout(() => {
                    try {
                        if (g._redman) {
                            g._redman.eyeClosed = false;
                            try { g._redman.mesh.scale.set(6,6,1); } catch(e){}
                        }
                    } catch (e) {}
                }, 2200);
            } catch (e) {}
        }

        // New: F key to throw an object at Evil Capybara (damage if present)
        if (ev.key.toLowerCase() === 'f') {
            try {
                const g = window.game;
                if (!g || !g._evilCapy || !g._evilCapy.alive) return;
                // spawn a throwable object that flies toward the boss
                const start = g.player.mesh.position.clone();
                const geom = new THREE.SphereGeometry(0.18, 8, 8);
                const mat = new THREE.MeshStandardMaterial({ color: 0xffff66, emissive: 0xffaa33 });
                const proj = new THREE.Mesh(geom, mat);
                proj.position.copy(start).add(new THREE.Vector3(0,1.0,0));
                g.scene.add(proj);

                const targetPos = g._evilCapy.mesh.position.clone();
                const dir = new THREE.Vector3().subVectors(targetPos, proj.position).normalize();
                const speed = 14;
                const startTime = Date.now();
                const life = 4000;
                const updateProj = () => {
                    try {
                        const dt = 16;
                        proj.position.add(dir.clone().multiplyScalar(speed * (dt/1000)));
                        const dist = proj.position.distanceTo(g._evilCapy.mesh.position);
                        if (dist < 1.2) {
                            // hit: deal damage and spawn effect
                            try {
                                // damage a modest amount to chip away at huge HP
                                if (g._evilCapy && typeof g._evilCapy.takeDamage === 'function') g._evilCapy.takeDamage(1000000);
                                // explosion visual
                                const exp = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 8), new THREE.MeshStandardMaterial({ color: 0xff7744, emissive:0xff4422 }));
                                exp.position.copy(proj.position);
                                g.scene.add(exp);
                                setTimeout(()=>{ try{ g.scene.remove(exp); }catch(e){} }, 400);
                            } catch (e){}
                            try { g.scene.remove(proj); } catch(e){}
                            return;
                        }
                        if (Date.now() - startTime > life) {
                            try { g.scene.remove(proj); } catch(e){}
                            return;
                        }
                        requestAnimationFrame(updateProj);
                    } catch (err) { try { g.scene.remove(proj);}catch(e){} }
                };
                updateProj();
                if (g._announcementText) {
                    g._announcementText.textContent = 'You threw an object at Evil Capybara!';
                    setTimeout(()=>{ try{ g._announcementText.textContent='UPDATES MORE SOON!'; }catch(e){} }, 1400);
                }
            } catch (err) {}
        }
    } catch (e) {}
});

// Mouse click: if Redman present and eyeClosed, slap reduces HP and plays a feedback sound
window.addEventListener('mousedown', (ev) => {
    try {
        const g = window.game;
        if (!g || !g._redman || !g._redman.alive) return;
        // distance check
        const d = g.player.mesh.position.distanceTo(g._redman.mesh.position);
        if (d > 6.5) {
            // too far to slap
            return;
        }
        // only allow effective slap when eye is closed (timed window)
        if (g._redman.eyeClosed) {
            try {
                // damage and visual feedback
                g._redman.takeDamage && g._redman.takeDamage(46);
                if (g.alertsEnabled) g.playSound('bomb');
                // small knockback
                try {
                    const dir = new THREE.Vector3().subVectors(g._redman.mesh.position, g.player.mesh.position).normalize();
                    g._redman.mesh.position.add(dir.multiplyScalar(1.2));
                } catch(e){}
            } catch (e) {}
        } else {
            // non-effective slap: small announcement
            if (g._announcementText) {
                g._announcementText.textContent = 'Redman is watching — close his eye first (press 7)!';
                setTimeout(()=>{ try{ g._announcementText.textContent='UPDATES MORE SOON!'; }catch(e){} }, 1400);
            }
        }
    } catch (e) {}
});

// P key: spawn a horde of thrower spiders and a Spider King
window.addEventListener('keydown', (e) => {
    if (!e || !e.key) return;
    if (e.key.toLowerCase() !== 'p') return;
    try {
        const count = 18;
        const loader = new THREE.TextureLoader();
        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const r = 8 + Math.random() * 18;
            const spawnPos = new THREE.Vector3(
                game.player.mesh.position.x + Math.cos(angle) * r,
                0,
                game.player.mesh.position.z + Math.sin(angle) * r
            );

            // spawn spider sprite (try texture, fallback color)
            let sprite = null;
            try {
                const tex = loader.load('/Thrower_Purple_spider.webp');
                const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
                sprite = new THREE.Sprite(mat);
                sprite.scale.set(1.8 + Math.random() * 0.6, 1.8 + Math.random() * 0.6, 1);
                sprite.position.copy(spawnPos);
                sprite.position.y = 1.2;
                game.scene.add(sprite);
            } catch (e) {
                const mat = new THREE.SpriteMaterial({ color: 0x993366 });
                sprite = new THREE.Sprite(mat);
                sprite.scale.set(1.6, 1.6, 1);
                sprite.position.copy(spawnPos);
                sprite.position.y = 1.2;
                game.scene.add(sprite);
            }

            // spider enemy object with throwing behavior
            const spider = {
                alive: true,
                mesh: sprite,
                speed: 1.8 + Math.random() * 0.9,
                throwTimer: 0.5 + Math.random() * 1.4,
                update(targetPos, dt) {
                    if (!this.alive) return;
                    try {
                        const dir = new THREE.Vector3().subVectors(targetPos, this.mesh.position);
                        dir.y = 0;
                        const dist = dir.length();
                        if (dist > 6) {
                            dir.normalize();
                            this.mesh.position.add(dir.multiplyScalar(this.speed * dt));
                        } else {
                            this.mesh.position.y = 1.2 + Math.sin(Date.now() * 0.002) * 0.06;
                        }

                        this.throwTimer -= dt;
                        if (this.throwTimer <= 0) {
                            this.throwTimer = 1.0 + Math.random() * 1.4;
                            // spawn projectile aimed at player
                            const ballMat = new THREE.MeshStandardMaterial({ color: 0x9b59ff, emissive: 0x7d3cff });
                            const ballGeo = new THREE.SphereGeometry(0.18, 8, 8);
                            const ball = new THREE.Mesh(ballGeo, ballMat);
                            const start = this.mesh.position.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.5, -0.4, (Math.random() - 0.5) * 0.5));
                            ball.position.copy(start);
                            ball.userData.dir = new THREE.Vector3().subVectors(game.player.mesh.position.clone().add(new THREE.Vector3(0, 0.9, 0)), start).normalize();
                            ball.userData.speed = 8 + Math.random() * 3;
                            ball.userData.spawnTime = Date.now();
                            ball.userData.maxLifeMs = 12000;
                            game.scene.add(ball);

                            const proj = {
                                alive: true,
                                mesh: ball,
                                update: (tp, dtdt) => {
                                    if (!proj.alive) return;
                                    proj.mesh.position.add(proj.mesh.userData.dir.clone().multiplyScalar(proj.mesh.userData.speed * dtdt));
                                    if (Date.now() - (proj.mesh.userData.spawnTime || 0) > (proj.mesh.userData.maxLifeMs || 12000)) {
                                        proj.alive = false;
                                        try { game.scene.remove(proj.mesh); } catch (e) {}
                                        return;
                                    }
                                    try {
                                        if (proj.mesh.position.distanceTo(game.player.mesh.position) < 1.0) {
                                            game.player.hp = (game.player.hp === undefined) ? 100 : game.player.hp;
                                            game.player.hp -= 14;
                                            proj.alive = false;
                                            try { game.scene.remove(proj.mesh); } catch (e) {}
                                            if (game.player.hp <= 0) {
                                                game.gameState.gameOver = true;
                                                const instr = document.getElementById('instructions');
                                                if (instr) instr.innerHTML = "GAME OVER — Killed by spiders! Refresh to retry.";
                                            }
                                        }
                                    } catch (e) {}
                                },
                                destroy: () => { proj.alive = false; try { game.scene.remove(proj.mesh); } catch (e) {} }
                            };
                            game.enemies.push(proj);
                        }
                    } catch (e) { }
                },
                destroy() { this.alive = false; try { game.scene.remove(this.mesh); } catch (e) { } }
            };

            game.enemies.push(spider);
        }

        // Spawn Spider King boss
        try {
            const tex = new THREE.TextureLoader().load('/Spider_king.webp');
            const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
            const king = new THREE.Sprite(mat);
            king.scale.set(7, 7, 1);
            king.position.copy(game.player.mesh.position).add(new THREE.Vector3(0, 6, -4));
            game.scene.add(king);

            const boss = {
                name: 'Spider King',
                alive: true,
                mesh: king,
                hp: 1200,
                attackTimer: 1.6,
                update(tp, dt) {
                    if (!boss.alive) return;
                    try {
                        const dir = new THREE.Vector3().subVectors(game.player.mesh.position, boss.mesh.position);
                        dir.y = 0;
                        if (dir.length() > 1.5) {
                            dir.normalize();
                            boss.mesh.position.add(dir.multiplyScalar(1.2 * dt));
                        }
                        boss.attackTimer -= dt;
                        if (boss.attackTimer <= 0) {
                            boss.attackTimer = 1.2 + Math.random() * 1.2;
                            // spawn a volley of fire/projectiles
                            for (let i = 0; i < 5; i++) {
                                const fMat = new THREE.MeshStandardMaterial({ color: 0x9b59ff, emissive: 0x7d3cff });
                                const fGeo = new THREE.SphereGeometry(0.28, 8, 8);
                                const ball = new THREE.Mesh(fGeo, fMat);
                                const start = boss.mesh.position.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2, -0.6, (Math.random() - 0.5) * 2));
                                ball.position.copy(start);
                                ball.userData.dir = new THREE.Vector3().subVectors(game.player.mesh.position.clone().add(new THREE.Vector3(0, 0.9, 0)), start).normalize();
                                ball.userData.speed = 10 + Math.random() * 3;
                                ball.userData.spawnTime = Date.now();
                                game.scene.add(ball);

                                const proj = {
                                    alive: true,
                                    mesh: ball,
                                    update: (tp2, dtdt) => {
                                        if (!proj.alive) return;
                                        proj.mesh.position.add(proj.mesh.userData.dir.clone().multiplyScalar(proj.mesh.userData.speed * dtdt));
                                        if (proj.mesh.position.distanceTo(game.player.mesh.position) < 1.2) {
                                            game.player.hp = (game.player.hp === undefined) ? 100 : game.player.hp;
                                            game.player.hp -= 32;
                                            proj.alive = false;
                                            try { game.scene.remove(proj.mesh); } catch (e) {}
                                            if (game.player.hp <= 0) {
                                                game.gameState.gameOver = true;
                                                const instr = document.getElementById('instructions');
                                                if (instr) instr.innerHTML = 'KILLED BY SPIDER KING! Refresh to retry.';
                                            }
                                        }
                                    },
                                    destroy: () => { proj.alive = false; try { game.scene.remove(proj.mesh); } catch (e) { } }
                                };
                                game.enemies.push(proj);
                            }
                        }
                    } catch (e) {}
                },
                destroy() { boss.alive = false; try { game.scene.remove(boss.mesh); } catch (e) { } }
            };

            game.enemies.push(boss);
            if (game._announcementText) {
                game._announcementText.textContent = 'P pressed: Spider horde and Spider King spawned!';
                setTimeout(() => { game._announcementText.textContent = 'UPDATES MORE SOON!'; }, 2000);
            }
        } catch (e) {
            console.warn('Failed to spawn Spider King', e);
        }
    } catch (err) {
        console.warn('P key spawn failed', err);
    }
});

 // Press B to spawn a baby capybara pet (if not already present)
window.addEventListener('keydown', (e) => {
    try {
        if (!e || !e.key) return;
        if (e.key.toLowerCase() !== 'b') return;

        // Create baby capybara if missing
        if (!game.world) return;
        if (game.world.babyCapybara) {
            // If already present, give it a bounce and move it near the player
            try {
                game.world.babyCapybara.position.copy(game.player.mesh.position).add(new THREE.Vector3(-1.5, 0.9, -1));
                game.world.babyCapybara.velocity = 0.24;
                if (typeof game.world.babyCapybara.bounce === 'function') game.world.babyCapybara.bounce();
                if (game._announcementText) {
                    game._announcementText.textContent = 'Baby Capybara already exists — moved closer!';
                    setTimeout(() => { try { game._announcementText.textContent = 'UPDATES MORE SOON!'; } catch(e){} }, 1600);
                }
            } catch (err) { console.warn('Failed to reposition baby capybara', err); }
            return;
        }

        try {
            const loader = new THREE.TextureLoader();
            const tex = loader.load('/baby capybara.webp', () => {
                try {
                    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
                    const baby = new THREE.Sprite(mat);
                    baby.scale.set(1.8, 1.2, 1);
                    baby.position.copy(game.player.mesh.position).add(new THREE.Vector3(-1.5, 0.9, -1.5));
                    baby.originalY = 0.9;
                    baby.velocity = 0;
                    baby.isPetting = false;
                    baby.hp = 50;
                    baby.born = '1960-01-16';
                    baby.name = 'Baby Capybara';
                    // gentle bounce helper
                    baby.bounce = () => { baby.velocity = 0.18; };
                    game.scene.add(baby);
                    game.world.babyCapybara = baby;

                    // update pet counter and announcement
                    game.gameState.pets = (game.gameState.pets || 0) + 1;
                    const petCounter = document.getElementById('pet-counter');
                    if (petCounter) petCounter.textContent = String(game.gameState.pets);
                    if (game._announcementText) {
                        game._announcementText.textContent = 'Baby Capybara spawned!';
                        setTimeout(() => { try { game._announcementText.textContent = 'UPDATES MORE SOON!'; } catch(e){} }, 1600);
                    }
                } catch (err) {
                    console.warn('Failed to create baby capybara sprite', err);
                }
            }, undefined, (err) => {
                console.error('Failed to load baby capybara texture', err);
                if (game._announcementText) {
                    game._announcementText.textContent = 'Failed to spawn Baby Capybara (texture load error).';
                    setTimeout(() => { try { game._announcementText.textContent = 'UPDATES MORE SOON!'; } catch(e){} }, 1600);
                }
            });
        } catch (err) {
            console.warn('Spawn baby key handler error', err);
        }
    } catch (err) {}
});

// --- New: The Eaterer boss (first-person encounter) ---
// spawn function: creates a fast-running boss with 100 HP and enables first-person mode + faster player
Game.prototype.spawnEatererBoss = function () {
    try {
        if (this._eaterer && this._eaterer.alive) {
            try { this._eaterer.mesh.position.copy(this.player.mesh.position).add(new THREE.Vector3(0, 6, -8)); this._eaterer.alive = true; } catch(e){}
            return;
        }
        const loader = new THREE.TextureLoader();
        let tex = null;
        try { tex = loader.load('/The Eaterer.jpeg'); } catch(e) { tex = null; }

        const mat = tex ? new THREE.SpriteMaterial({ map: tex, transparent: true }) : new THREE.SpriteMaterial({ color: 0xff3333 });
        const sprite = new THREE.Sprite(mat);
        sprite.scale.set(8, 8, 1);
        sprite.position.copy(this.player.mesh.position).add(new THREE.Vector3(0, 6, -8));
        sprite.name = 'The Eaterer';
        this.scene.add(sprite);

        const boss = {
            name: 'The Eaterer',
            alive: true,
            mesh: sprite,
            hp: 100,
            speed: 6.5, // runs fast
            update: (tp, dt) => {
                if (!boss.alive) return;
                try {
                    // chase player fast on XZ plane
                    const dir = new THREE.Vector3().subVectors(tp, boss.mesh.position);
                    dir.y = 0;
                    if (dir.length() > 0.1) {
                        dir.normalize();
                        boss.mesh.position.add(dir.multiplyScalar(boss.speed * dt));
                    }
                    // bob for visual effect
                    boss.mesh.position.y = 5.6 + Math.sin(Date.now() * 0.002) * 0.35;
                } catch (e) {}
            },
            takeDamage: (amt) => {
                try {
                    const dmg = Number(amt) || 12;
                    boss.hp = (boss.hp === undefined) ? 100 : boss.hp - dmg;
                    if (this._announcementText) this._announcementText.textContent = `The Eaterer hit! HP: ${Math.max(0,boss.hp)}`;
                    if (boss.hp <= 0) {
                        boss.alive = false;
                        try { this.scene.remove(boss.mesh); } catch(e){}
                        if (this._announcementText) {
                            this._announcementText.textContent = 'You defeated The Eaterer! Credits to BagelMaster5000';
                            setTimeout(()=>{ try{ this._announcementText.textContent='UPDATES MORE SOON!'; }catch(e){} }, 3000);
                        }
                        // restore some player speed if changed
                        try { this.player.speed = 5; } catch(e){}
                    }
                } catch (e) {}
            },
            destroy: () => {
                boss.alive = false;
                try { this.scene.remove(boss.mesh); } catch(e){}
            }
        };

        this._eaterer = boss;
        this.enemies.push(boss);

        // Set player to run fast as well
        try { this.player.speed = 8.2; } catch(e){}
        // Enable first-person mode for the encounter
        try { this.enableFirstPersonMode && this.enableFirstPersonMode(); } catch(e){}

        if (this._announcementText) {
            this._announcementText.textContent = 'BOSS — The Eaterer appears! Objective: Throw Pets at The Eaterer; avoid being eaten. Left-click or F to throw pets. Credits to BagelMaster5000';
            setTimeout(()=>{ try{ this._announcementText.textContent='UPDATES MORE SOON!'; }catch(e){} }, 4200);
        }

        // audio cue
        if (this.alertsEnabled) this.playSound('day');
    } catch (e) {
        console.warn('spawnEatererBoss failed', e);
    }
};

// Fan Oise special sequence: trigger GDI visual overlay, loop btyebeats, vanish pets, make fan chase faster, and kick on capture
Game.prototype._triggerFanOiseSequence = function () {
    try {
        if (this._fanSequenceActive) return;
        this._fanSequenceActive = true;

        // create rotating GDI overlay if missing
        let gdi = document.getElementById('gdi-overlay');
        if (!gdi) {
            gdi = document.createElement('div');
            gdi.id = 'gdi-overlay';
            gdi.style.position = 'fixed';
            gdi.style.inset = '0';
            gdi.style.zIndex = '200000';
            gdi.style.background = 'rgba(0,0,0,0.92)';
            gdi.style.pointerEvents = 'none';
            gdi.style.display = 'flex';
            gdi.style.alignItems = 'center';
            gdi.style.justifyContent = 'center';
            gdi.style.color = '#0ff';
            gdi.style.fontFamily = 'monospace';
            gdi.style.fontSize = '22px';
            gdi.innerHTML = '<div id="gdi-text">GDI EFFECT - GLITCH</div>';
            document.body.appendChild(gdi);
        } else {
            gdi.style.display = 'flex';
        }

        // rotating effect
        if (!window._gdiRot) {
            window._gdiRot = { deg: 0, timer: setInterval(() => {
                try {
                    window._gdiRot.deg = (window._gdiRot.deg + 1.2) % 360;
                    gdi.style.transform = `rotate(${window._gdiRot.deg}deg)`;
                } catch (e) {}
            }, 16) };
        }

        // start btyebeats loop audio (use Fieldofambush as placeholder beat), loop tightly
        try {
            if (!this._btyeAudio) {
                const a = new Audio('Fieldofambush.mp3.mpeg.wav');
                a.loop = true;
                a.volume = 0.85;
                a.play().catch(()=>{});
                this._btyeAudio = a;
            } else {
                try { this._btyeAudio.play().catch(()=>{}); } catch(e){}
            }
        } catch (e) {}

        // remove pets from world (vanish visuals) — do it quietly and without pet sound
        try {
            const petKeys = ['cashy','builderG','dancingBanana','babyCapybara','parrot','chromebook'];
            petKeys.forEach(k => {
                try {
                    if (this.world && this.world[k]) {
                        try { this.scene.remove(this.world[k]); } catch (e) {}
                        this.world[k] = null;
                    }
                } catch (e) {}
            });
            // update pet counter UI
            try { this.gameState.pets = 0; const petCounter = document.getElementById('pet-counter'); if (petCounter) petCounter.textContent = '0'; } catch(e){}
        } catch (e) {}

        // make Fan Oise chase faster: tag fan if present and increase its chase speed
        try {
            if (this._fanOise && this._fanOise.userData && this._fanOise.userData.isFanOise) {
                this._fanOise.userData.chase = true;
                this._fanOise.userData.chaseSpeed = 8.2; // faster chase
                // visual cue: enlarge slightly
                try { this._fanOise.scale.set(4.2,4.2,1); } catch(e){}
            }
        } catch (e) {}

        // set a persistent flag to let update loop move the fan toward player and check capture
        this._fanSequenceStartedAt = Date.now();

        // Also periodically (every 2s) intensify overlay text for dramatics
        this._fanGdiTicker = setInterval(() => {
            try {
                const t = document.getElementById('gdi-text');
                if (t) t.textContent = (Math.random() > 0.5) ? 'GDI EFFECT - BYTEBEATS ACTIVE' : 'GDI EFFECT - DATA CORRUPTION';
            } catch (e) {}
        }, 2000);
    } catch (e) {
        console.warn('Failed to start Fan Oise sequence', e);
    }
};


// Insert: Run The Bosses gamemode implementation
Game.prototype.startRunTheBosses = function () {
    try {
        // Setup mode flags
        this.gameState.runTheBosses = true;
        this.gameState.runBossesPetsCollected = 0;
        this.gameState.runBossesPetsNeeded = 19;
        this.gameState.runBossesAlive = true;

        // Enter first-person mode and boost player speed for this intense encounter
        try {
            this.enableFirstPersonMode && this.enableFirstPersonMode();
            this.player.speed = 8.5;
        } catch (e) {}

        // Teleport to a compact arena area for the run
        try {
            this.player.mesh.position.set(0, 0, -6);
            if (this.world) this.world.playerPosition = this.player.mesh.position;
        } catch (e) {}

        // Spawn James and The Eaterer (use existing spawn helpers if present)
        try {
            if (typeof this.spawnJamesBoss === 'function') this.spawnJamesBoss();
            if (typeof this.spawnEatererBoss === 'function') this.spawnEatererBoss();
        } catch (e) { console.warn('Failed to spawn initial bosses', e); }

        // Spawn an initial wave of enemies to pressure the player
        try {
            const p = this.player.mesh.position.clone();
            for (let i = 0; i < 18; i++) {
                const angle = Math.random() * Math.PI * 2;
                const r = 6 + Math.random() * 12;
                const spawnPos = new THREE.Vector3(p.x + Math.cos(angle) * r, 0, p.z + Math.sin(angle) * r);
                this.enemies.push(new Enemy(this.scene, spawnPos));
            }
        } catch (e) {}

        // Start spawning shaking world debris periodically (falling projectiles)
        try {
            if (this._runBossesDebrisTimer) clearInterval(this._runBossesDebrisTimer);
            this._runBossesDebrisTimer = setInterval(() => {
                try {
                    const count = 3 + Math.floor(Math.random() * 3);
                    for (let i = 0; i < count; i++) {
                        const angle = Math.random() * Math.PI * 2;
                        const r = 4 + Math.random() * 20;
                        const spawnX = this.player.mesh.position.x + Math.cos(angle) * r;
                        const spawnZ = this.player.mesh.position.z + Math.sin(angle) * r;
                        const mat = new THREE.MeshStandardMaterial({ color: 0x8B6F4E, emissive: 0x442200 });
                        const ball = new THREE.Mesh(new THREE.SphereGeometry(0.26 + Math.random() * 0.3, 8, 8), mat);
                        ball.position.set(spawnX, 12 + Math.random() * 10, spawnZ);
                        ball.userData.falling = true;
                        ball.userData.speed = 6 + Math.random() * 8;
                        this.scene.add(ball);
                        const proj = {
                            alive: true,
                            mesh: ball,
                            update: (tp, dtdt) => {
                                if (!proj.alive) return;
                                proj.mesh.position.y -= proj.mesh.userData.speed * dtdt;
                                const drift = new THREE.Vector3().subVectors(this.player.mesh.position, proj.mesh.position);
                                drift.y = 0;
                                if (drift.length() > 0.1) drift.normalize().multiplyScalar(0.12 * dtdt);
                                proj.mesh.position.add(drift);
                                if (proj.mesh.position.y <= 0.9) {
                                    // damage player if close, else harmless impact
                                    try {
                                        if (proj.mesh.position.distanceTo(this.player.mesh.position) < 1.6) {
                                            this.player.hp = (this.player.hp === undefined) ? 100 : this.player.hp;
                                            this.player.hp -= 22;
                                            if (this.player.hp <= 0) {
                                                this.gameState.gameOver = true;
                                                document.getElementById('instructions').innerHTML = "GAME OVER — Crushed by debris! Refresh to retry.";
                                            }
                                        }
                                    } catch (e) {}
                                    proj.alive = false;
                                    try { this.scene.remove(proj.mesh); } catch (e) {}
                                }
                            },
                            destroy: () => { proj.alive = false; try { this.scene.remove(proj.mesh); } catch (e) {} }
                        };
                        this.enemies.push(proj);
                    }
                } catch (e) {}
            }, 1600);
        } catch (e) {}

        // Watch for The Eaterer death to trigger its unique line and spawn toggles for James wave
        try {
            if (this._runBossesWatcher) clearInterval(this._runBossesWatcher);
            this._runBossesWatcher = setInterval(() => {
                try {
                    // If eaterer exists and is dead/removed, run defeat flow once
                    if (this._eaterer && !this._eaterer.alive && !this._eaterer._defeatHandled) {
                        this._eaterer._defeatHandled = true;
                        // message injection
                        try {
                            // show the required phrase
                            const phrase = "WHAT HAVE YOU DONE 6123w7uajshdgetw728eikrfjnhye48";
                            alert(phrase);
                            if (this._announcementText) this._announcementText.textContent = phrase;
                        } catch (e) {}
                        // Toggle an aggressive James wave when eaterer dies
                        try {
                            if (typeof this.spawnJamesBoss === 'function') {
                                // spawn additional James instances for a chaos event
                                for (let j = 0; j < 2; j++) {
                                    try { this.spawnJamesBoss(); } catch (e) {}
                                }
                            }
                            // spawn extra enemies quickly
                            const p = this.player.mesh.position.clone();
                            for (let i = 0; i < 28; i++) {
                                const angle = Math.random() * Math.PI * 2;
                                const rr = 6 + Math.random() * 28;
                                const spawnPos = new THREE.Vector3(p.x + Math.cos(angle) * rr, 0, p.z + Math.sin(angle) * rr);
                                this.enemies.push(new Enemy(this.scene, spawnPos));
                            }
                        } catch (e) {}
                    }

                    // Victory condition: collected pets >= needed
                    if (this.gameState.runBossesPetsCollected >= this.gameState.runBossesPetsNeeded && this.gameState.runBossesAlive) {
                        this.gameState.runBossesAlive = false;
                        // stop debris timer
                        try { if (this._runBossesDebrisTimer) { clearInterval(this._runBossesDebrisTimer); this._runBossesDebrisTimer = null; } } catch (e) {}
                        // James funny defeat line and finalization
                        try {
                            const phrase = "ahey376728q9wisdjeuwyshjekwisn and got defeated";
                            alert(phrase);
                            if (this._announcementText) this._announcementText.textContent = phrase;
                        } catch (e) {}
                        // spawn escape music and mark world abandoned (simple audio trigger)
                        try { this.playSound('jelly'); } catch (e) {}
                        // reward: spawn celebratory visuals and clear enemies
                        try {
                            this.enemies.forEach(en => { try { if (en && en.destroy) en.destroy(); else if (en && en.mesh) this.scene.remove(en.mesh); } catch (e) {} });
                            this.enemies = [];
                        } catch (e) {}
                    }
                } catch (e) {}
            }, 600);
        } catch (e) {}

        // Add UI instructions
        try {
            const instr = document.getElementById('instructions');
            if (instr) instr.innerHTML = "RUN THE BOSSES — First-person; collect pets (19) to escape, throw pets at bosses (click / F) and survive debris!";
            instr.style.background = "rgba(0,0,0,0.7)";
        } catch (e) {}
    } catch (err) {
        console.warn('startRunTheBosses failed', err);
    }
};

// Hook: boss selector delegated click handler support for "bf-eaterer"
document.addEventListener('click', (ev) => {
    try {
        if (!ev || !ev.target) return;
        const id = ev.target.id || (ev.target.dataset && ev.target.dataset.id);

        if (id === 'bf-eaterer') {
            try {
                if (window.game && typeof window.game.spawnEatererBoss === 'function') {
                    const dlg = document.getElementById('boss-selector-dialog');
                    if (dlg) dlg.style.display = 'none';
                    window.game.spawnEatererBoss();
                } else {
                    alert('The Eaterer spawn not available.');
                }
            } catch (err) {
                console.warn('Failed to spawn The Eaterer via delegated handler', err);
            }
            return;
        }
    } catch (e) {}
});

// Left-click or F: throw a pet projectile at The Eaterer if present (damages eaterer)
function _throwPetProjectileAtEaterer() {
    try {
        const g = window.game;
        if (!g || !g._eaterer || !g._eaterer.alive) return;
        const start = g.player.mesh.position.clone().add(new THREE.Vector3(0, 1.0, 0));
        // Try to use a pet sprite from world (prefer babyCapybara, cashy, builderG, dancingBanana)
        const petKeys = ['babyCapybara','cashy','builderG','dancingBanana','parrot','chromebook'];
        let petSprite = null;
        for (const k of petKeys) {
            try {
                if (g.world && g.world[k]) { petSprite = g.world[k]; g.world[k] = null; break; }
            } catch (e) {}
        }
        // If no actual pet, just spawn a small throwable sphere representing a pet
        const scene = g.scene;
        let projMesh = null;
        if (petSprite) {
            // detach and use it as projectile
            projMesh = petSprite;
            projMesh.position.copy(start);
            // ensure it's not treated as a world pet anymore
            try { scene.add(projMesh); } catch(e){}
        } else {
            const geom = new THREE.SphereGeometry(0.22, 8, 8);
            const mat = new THREE.MeshStandardMaterial({ color: 0xffcc66, emissive: 0xff9933 });
            projMesh = new THREE.Mesh(geom, mat);
            projMesh.position.copy(start);
            scene.add(projMesh);
        }

        // aim at eaterer and move projectile
        const targetPos = g._eaterer.mesh.position.clone();
        const dir = new THREE.Vector3().subVectors(targetPos, projMesh.position).normalize();
        const speed = 16;
        const startTime = Date.now();
        const life = 4000;
        const tickProj = () => {
            try {
                projMesh.position.add(dir.clone().multiplyScalar(speed * (1/60)));
                const dist = projMesh.position.distanceTo(g._eaterer.mesh.position);
                if (dist < 1.2) {
                    // hit: apply damage and remove projectile
                    try {
                        // damage scale: if was an actual pet, bigger damage
                        const damage = petSprite ? 28 : 12;
                        g._eaterer.takeDamage && g._eaterer.takeDamage(damage);
                        // small effect
                        const fx = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 8), new THREE.MeshStandardMaterial({ color: 0xff7744, emissive:0xff5522 }));
                        fx.position.copy(projMesh.position);
                        scene.add(fx);
                        setTimeout(()=>{ try { scene.remove(fx); } catch(e){} }, 400);
                    } catch (e) {}
                    try { if (projMesh && projMesh.parent) projMesh.parent.remove(projMesh); } catch(e){}
                    return;
                }
                if (Date.now() - startTime > life) {
                    try { if (projMesh && projMesh.parent) projMesh.parent.remove(projMesh); } catch(e){}
                    return;
                }
                requestAnimationFrame(tickProj);
            } catch (err) { try { if (projMesh && projMesh.parent) projMesh.parent.remove(projMesh); } catch(e){} }
        };
        tickProj();
        if (g._announcementText) {
            g._announcementText.textContent = 'You threw a pet!';
            setTimeout(()=>{ try{ g._announcementText.textContent='UPDATES MORE SOON!'; }catch(e){} }, 1200);
        }
    } catch (e) { console.warn('throwPetProjectileAtEaterer error', e); }
}

// bind left mouse down to throw pet at eaterer
window.addEventListener('mousedown', (ev) => {
    try {
        // allow normal Redman slap behavior to run too; only trigger pet-throw if eaterer exists and left button
        if (ev.button === 0) _throwPetProjectileAtEaterer();
    } catch (e) {}
});
// bind F to throw as well
window.addEventListener('keydown', (ev) => {
    try {
        if (!ev || !ev.key) return;
        if (ev.key.toLowerCase() === 'f') {
            _throwPetProjectileAtEaterer();
        }
    } catch (e) {}
});