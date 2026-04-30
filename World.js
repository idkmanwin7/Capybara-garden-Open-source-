import * as THREE from 'three';

export class GardenWorld {
    constructor(scene, settings) {
        this.scene = scene;
        this.settings = settings || {};
        // container for vegetation meshes so they can be removed/rebuilt
        this._vegetationItems = [];
        this.setupLights();
        this.setupGround();
        this.setupCashy();
        this.setupBuilderG();
        this.setupTimeG();
        this.setupPlant();
        this.setupDancingBanana();
        this.setupParrot();
        this.setupChromebook();
        this.setupFrogs();
        this.setupPuppet();
        // new pets initialization
        try { this.setupSnowman(); } catch (e) { console.warn('setupSnowman init failed', e); }
        try { this.setupShark(); } catch (e) { console.warn('setupShark init failed', e); }
        try { this.setupBonusDollar(); } catch (e) { console.warn('setupBonusDollar init failed', e); }
        try { this.setupZombieDollar(); } catch (e) { console.warn('setupZombieDollar init failed', e); }
        this.setupHouse();
    }

    setupLights() {
        const ambient = new THREE.AmbientLight(0xffffff, 0.8);
        this.scene.add(ambient);

        const sun = new THREE.DirectionalLight(0xffffff, 1);
        sun.position.set(10, 20, 10);
        sun.castShadow = true;
        this.scene.add(sun);
        
        this.scene.background = new THREE.Color(0x87CEEB);
        this.scene.fog = new THREE.Fog(0x87CEEB, 20, 50);
    }

    setupGround() {
        const geometry = new THREE.PlaneGeometry(100, 100);

        // Use a grass texture for the ground for a richer visual instead of a flat color.
        // Texture is tiled to cover the large ground plane.
        const loader = new THREE.TextureLoader();
        const grassTex = loader.load('/capybara_texture.png');
        grassTex.wrapS = THREE.RepeatWrapping;
        grassTex.wrapT = THREE.RepeatWrapping;
        grassTex.repeat.set(24, 24); // tile the texture across the plane
        const material = new THREE.MeshStandardMaterial({ map: grassTex, roughness: 1.0 });
        const ground = new THREE.Mesh(geometry, material);
        ground.rotation.x = -Math.PI / 2;
        ground.receiveShadow = true;
        this.scene.add(ground);

        // helper to place objects on ground with slight Y jitter
        const placeOnGround = (mesh, x, z, y = 0.05) => {
            mesh.position.set(x, y, z);
            mesh.rotation.y = Math.random() * Math.PI * 2;
            this.scene.add(mesh);
            // track vegetation items so we can remove them later if needed
            if (this._vegetationItems && mesh !== ground) this._vegetationItems.push(mesh);
        };

        // Only create vegetation if settings allow (default: true)
        const vegetationEnabled = (this.settings.vegetation !== false);

        if (vegetationEnabled) {
            // Flower and small tuft clusters (many small decorative items)
            for (let i = 0; i < 60; i++) {
                const flowerColor = Math.random() > 0.6 ? 0xffcc00 : (Math.random() > 0.5 ? 0xffffff : 0xff77aa);
                const flower = new THREE.Mesh(
                    new THREE.SphereGeometry(0.08 + Math.random() * 0.06, 8, 8),
                    new THREE.MeshStandardMaterial({ color: flowerColor })
                );
                const x = Math.random() * 60 - 30;
                const z = Math.random() * 60 - 30;
                placeOnGround(flower, x, z, 0.08 + Math.random() * 0.05);
            }

            // Grass tufts: small groups of thin blades made from boxes for performance
            const grassMat = new THREE.MeshStandardMaterial({ color: 0x2e8b57 });
            for (let i = 0; i < 120; i++) {
                const tuft = new THREE.Group();
                const blades = 3 + Math.floor(Math.random() * 4);
                for (let b = 0; b < blades; b++) {
                    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.2 + Math.random() * 0.25, 0.01), grassMat);
                    blade.position.x = (Math.random() - 0.5) * 0.12;
                    blade.position.z = (Math.random() - 0.5) * 0.12;
                    blade.position.y = 0.1 + Math.random() * 0.15;
                    blade.rotation.z = (Math.random() - 0.5) * 0.6;
                    tuft.add(blade);
                }
                const x = Math.random() * 80 - 40;
                const z = Math.random() * 80 - 40;
                tuft.scale.setScalar(0.8 + Math.random() * 1.2);
                placeOnGround(tuft, x, z, 0.02);
            }

            // Bush clumps: larger rounded geometry to create visual variety
            const bushMat = new THREE.MeshStandardMaterial({ color: 0x116622 });
            for (let i = 0; i < 18; i++) {
                const bush = new THREE.Group();
                const parts = 2 + Math.floor(Math.random() * 4);
                for (let p = 0; p < parts; p++) {
                    const sph = new THREE.Mesh(
                        new THREE.SphereGeometry(0.4 + Math.random() * 0.8, 10, 8),
                        bushMat
                    );
                    sph.position.set((Math.random() - 0.5) * 0.8, 0.2 + Math.random() * 0.4, (Math.random() - 0.5) * 0.8);
                    sph.castShadow = true;
                    bush.add(sph);
                }
                const x = Math.random() * 60 - 30;
                const z = Math.random() * 60 - 30;
                bush.scale.setScalar(0.8 + Math.random() * 1.6);
                placeOnGround(bush, x, z, 0.02);
            }

            // Keep some larger decorative single flowers near center / points of interest
            const centerFlowers = [
                { x: 4, z: -3 },
                { x: -3, z: -2 },
                { x: 2, z: 2 }
            ];
            centerFlowers.forEach(pos => {
                const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.6), new THREE.MeshStandardMaterial({ color: 0x2e8b57 }));
                stem.position.y = 0.3;
                const bloom = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 8), new THREE.MeshStandardMaterial({ color: 0xff66aa }));
                bloom.position.y = 0.6;
                const flowerGroup = new THREE.Group();
                flowerGroup.add(stem, bloom);
                placeOnGround(flowerGroup, pos.x + (Math.random()-0.5)*0.6, pos.z + (Math.random()-0.5)*0.6, 0.02);
            });
        }
    }

    // remove or recreate vegetation based on current settings
    rebuildVegetation() {
        // remove previous vegetation items
        if (this._vegetationItems && this._vegetationItems.length) {
            this._vegetationItems.forEach(item => {
                try { this.scene.remove(item); } catch(e) {}
            });
            this._vegetationItems.length = 0;
        }
        // recreate vegetation if enabled
        if (this.settings.vegetation !== false) {
            // reuse setupGround's vegetation block by calling setupGround to place items
            // but avoid duplicating the ground plane: temporarily store current ground, call setupGround which will add items
            // simplest: call the vegetation portion by invoking setupGround again which will add items and track them
            this.setupGround();
        }
    }

    setupCashy() {
        const textureLoader = new THREE.TextureLoader();
        const cashyTex = textureLoader.load('/Charcther_icon.webp');
        const material = new THREE.SpriteMaterial({ map: cashyTex });
        this.cashy = new THREE.Sprite(material);
        this.cashy.scale.set(2, 2, 1);
        this.cashy.position.set(-3, 1, -2);
        this.scene.add(this.cashy);
        
        this.cashy.isPetting = false;
        this.cashy.originalY = 1;
        this.cashy.bounce = () => {
            this.cashy.velocity = 0.25;
        };
        this.cashy.velocity = 0;
        // health points for pet
        this.cashy.hp = 100;
    }

    setupBuilderG() {
        const textureLoader = new THREE.TextureLoader();
        const gTex = textureLoader.load('/channels4_profile (6).jpg');
        const material = new THREE.SpriteMaterial({ map: gTex });
        this.builderG = new THREE.Sprite(material);
        this.builderG.scale.set(2, 2, 1);
        this.builderG.position.set(-5, 1, 3);
        this.scene.add(this.builderG);
        
        this.builderG.isPetting = false;
        this.builderG.originalY = 1;
        this.builderG.bounce = () => {
            this.builderG.velocity = 0.25;
        };
        this.builderG.velocity = 0;
        // health points for pet
        this.builderG.hp = 100;
    }

    setupTimeG() {
        const textureLoader = new THREE.TextureLoader();
        const timeTex = textureLoader.load('/videoframe_1086.png');
        const material = new THREE.SpriteMaterial({ map: timeTex });
        this.timeG = new THREE.Sprite(material);
        this.timeG.scale.set(1.5, 1.5, 1);
        this.timeG.position.set(0, 1, -5);
        this.scene.add(this.timeG);
        
        this.timeG.originalY = 1;
        this.timeG.bounce = () => {
            this.timeG.velocity = 0.3;
        };
        this.timeG.velocity = 0;
    }

    setupPlant() {
        this.plantGroup = new THREE.Group();
        this.plantGroup.position.set(4, 0, -3);
        this.scene.add(this.plantGroup);

        this.plant = new THREE.Mesh(
            new THREE.SphereGeometry(0.2, 16, 16),
            new THREE.MeshStandardMaterial({ color: 0x8B4513 })
        );
        this.plantGroup.add(this.plant);
    }

    setupDancingBanana() {
        const textureLoader = new THREE.TextureLoader();
        const bananaTex = textureLoader.load('/DancingBanana.gif');
        const material = new THREE.SpriteMaterial({ map: bananaTex, transparent: true });
        this.dancingBanana = new THREE.Sprite(material);
        this.dancingBanana.scale.set(2.2, 2.2, 1);
        this.dancingBanana.position.set(2, 1, 2);
        this.scene.add(this.dancingBanana);

        this.dancingBanana.isDancing = false;
        this.dancingBanana.originalY = 1;
        this.dancingBanana.velocity = 0;
        // health points for pet
        this.dancingBanana.hp = 100;
        this.dancingBanana.following = true; // will follow player
    }

    setupParrot() {
        const textureLoader = new THREE.TextureLoader();
        const parrotTex = textureLoader.load('/indir (1).jpg');
        const material = new THREE.SpriteMaterial({ map: parrotTex, transparent: true });
        this.parrot = new THREE.Sprite(material);
        this.parrot.scale.set(2.4, 2.4, 1);
        this.parrot.position.set(6, 1.2, -1);
        this.scene.add(this.parrot);

        this.parrot.originalY = 1.2;
        this.parrot.velocity = 0;
        this.parrot.isSpeaking = false;
    }

    // Chromebook sprite: a small friendly laptop NPC (uses chromebookguy.png)
    setupChromebook() {
        try {
            const textureLoader = new THREE.TextureLoader();
            const chromebookTex = textureLoader.load('/chromebookguy.png');
            const mat = new THREE.SpriteMaterial({ map: chromebookTex, transparent: true });
            this.chromebook = new THREE.Sprite(mat);
            this.chromebook.scale.set(2.0, 2.0, 1);
            // place near player start / Cashy
            this.chromebook.position.set(-1, 1.0, 2);
            this.scene.add(this.chromebook);

            this.chromebook.originalY = 1.0;
            this.chromebook.velocity = 0;
            this.chromebook.isInteractive = true;
            this.chromebook.bounce = () => { this.chromebook.velocity = 0.18; };
            this.chromebook.name = 'Chromebook';
        } catch (e) {
            console.warn('Failed to create Chromebook sprite', e);
        }
    }

    // Frogs: jumping pet animals that have 100 HP and will attack nearby enemies.
    // They do not trigger the global pet sound when petted.
    setupFrogs() {
        this.frogs = [];
        const textureLoader = new THREE.TextureLoader();
        const frogTex = textureLoader.load('/Frog.png');
        // Create a small group of frogs placed near the player start area
        const positions = [
            { x: 2, z: -1 },
            { x: 3.4, z: -2.2 },
            { x: 1.2, z: 1.6 }
        ];
        positions.forEach((pos, idx) => {
            try {
                const mat = new THREE.SpriteMaterial({ map: frogTex, transparent: true });
                const spr = new THREE.Sprite(mat);
                spr.scale.set(1.2, 1.2, 1);
                spr.position.set(pos.x, 0.9, pos.z);
                spr.originalY = 0.9;
                spr.velocity = 0;
                spr.isPetting = false;
                spr.hp = 100;
                spr.name = `Frog_${idx}`;
                // jumping metadata
                spr.jumpCooldown = 1.2 + Math.random() * 1.0;
                spr.jumpTimer = Math.random() * spr.jumpCooldown;
                spr.isAirborne = false;
                spr.jumpStrength = 0.9 + Math.random() * 0.6;
                this.scene.add(spr);
                this.frogs.push(spr);
            } catch (e) { console.warn('Failed to spawn frog', e); }
        });
    }

    // Spawn hostile poison dart frogs (used by Mushroom Gnomes theme)
    spawnPoisonDartFrogs(count = 6, opts = {}) {
        try {
            this._poisonFrogs = this._poisonFrogs || [];
            const textureLoader = new THREE.TextureLoader();
            const tex = textureLoader.load('/Poison Dart Frog.webp'); // reuse frog image; color indicates poison
            for (let i = 0; i < count; i++) {
                const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: 0x1aff66, transparent: true }));
                spr.scale.set(1.1 + Math.random() * 0.6, 1.1 + Math.random() * 0.6, 1);
                const ang = Math.random() * Math.PI * 2;
                const r = 4 + Math.random() * 20;
                const px = (this.playerPosition ? this.playerPosition.x : 0) + Math.cos(ang) * r;
                const pz = (this.playerPosition ? this.playerPosition.z : 0) + Math.sin(ang) * r;
                spr.position.set(px, 0.9, pz);
                spr.userData = spr.userData || {};
                spr.userData.poison = true;
                spr.userData.aggressive = !!opts.aggressive;
                spr.userData.reproduce = !!opts.reproduce;
                spr.userData._phase = Math.random()*10;
                this.scene.add(spr);
                this._poisonFrogs.push(spr);
            }
        } catch (e) { console.warn('spawnPoisonDartFrogs failed', e); }
    }

    // helper to spawn a single poison frog at a given world position (used by reproduction)
    _spawnSinglePoisonFrog(pos) {
        try {
            this._poisonFrogs = this._poisonFrogs || [];
            const textureLoader = new THREE.TextureLoader();
            const tex = textureLoader.load('/Poison Dart Frog.webp');
            const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: 0x1aff66, transparent: true }));
            spr.scale.set(1.0, 1.0, 1);
            spr.position.copy(pos);
            spr.position.y = 0.9;
            spr.userData = spr.userData || {};
            spr.userData.poison = true;
            spr.userData.aggressive = true;
            spr.userData.reproduce = true;
            spr.userData._phase = Math.random()*10;
            this.scene.add(spr);
            this._poisonFrogs.push(spr);
        } catch (e) { console.warn('_spawnSinglePoisonFrog failed', e); }
    }

    setupPuppet() {
        try {
            const loader = new THREE.TextureLoader();
            const tex = loader.load('/amber puppet.jpg');
            const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
            this.puppet = new THREE.Sprite(mat);
            this.puppet.scale.set(1.6, 1.6, 1);
            // place puppet near central area by default
            this.puppet.position.set(1.5, 0.9, -1.8);
            this.scene.add(this.puppet);

            this.puppet.originalY = 0.9;
            this.puppet.velocity = 0;
            this.puppet.isPetting = false;
            this.puppet.name = 'Puppet';
            // gentle bounce helper
            this.puppet.bounce = () => { this.puppet.velocity = 0.12; };
        } catch (e) {
            console.warn('setupPuppet failed', e);
        }
    }

    // New pet: Monstrous Snowman (no pet sound)
    setupSnowman() {
        try {
            const loader = new THREE.TextureLoader();
            const tex = loader.load('/Screenshot_2026.04.03_09.33.17.948.png');
            const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
            this.snowman = new THREE.Sprite(mat);
            this.snowman.scale.set(2.6, 2.6, 1);
            this.snowman.position.set(3.2, 0.9, -2.4);
            this.scene.add(this.snowman);

            this.snowman.originalY = 0.9;
            this.snowman.velocity = 0;
            this.snowman.isPetting = false;
            this.snowman.name = 'Monstrous Snowman';
            this.snowman.bounce = () => { this.snowman.velocity = 0.14; };
            // mark as silent pet (no pet sound on interaction)
            this.snowman.userData.noPetSound = true;
        } catch (e) {
            console.warn('setupSnowman failed', e);
        }
    }

    // New pet: Shark (visual sprite)
    setupShark() {
        try {
            const loader = new THREE.TextureLoader();
            const tex = loader.load('/Shark (1).png');
            const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
            this.shark = new THREE.Sprite(mat);
            this.shark.scale.set(2.6, 2.6, 1);
            this.shark.position.set(-6, 0.9, -3.2);
            this.scene.add(this.shark);

            this.shark.originalY = 0.9;
            this.shark.velocity = 0;
            this.shark.isPetting = false;
            this.shark.name = 'Shark';
            this.shark.bounce = () => { this.shark.velocity = 0.12; };
            this.shark.userData.isPredator = true;
        } catch (e) {
            console.warn('setupShark failed', e);
        }
    }

    // New pet: Bonus Dollar 1 (no pet sound)
    setupBonusDollar() {
        try {
            const loader = new THREE.TextureLoader();
            const tex = loader.load('/Screenshot_2026.04.06_10.33.19.265.png');
            const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
            this.bonusDollar = new THREE.Sprite(mat);
            this.bonusDollar.scale.set(1.8, 1.8, 1);
            this.bonusDollar.position.set(-2.6, 0.9, 2.2);
            this.scene.add(this.bonusDollar);

            this.bonusDollar.originalY = 0.9;
            this.bonusDollar.velocity = 0;
            this.bonusDollar.isPetting = false;
            this.bonusDollar.name = 'Bonus Dollar 1';
            this.bonusDollar.bounce = () => { this.bonusDollar.velocity = 0.12; };
            this.bonusDollar.userData.noPetSound = true;
        } catch (e) {
            console.warn('setupBonusDollar failed', e);
        }
    }

    // New pet: Zombie Dollar (no pet sound) - uses provided game screenshot asset
    setupZombieDollar() {
        try {
            const loader = new THREE.TextureLoader();
            const tex = loader.load('/image (7).png');
            const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
            this.zombieDollar = new THREE.Sprite(mat);
            this.zombieDollar.scale.set(2.0, 2.0, 1);
            this.zombieDollar.position.set(0.6, 0.9, 3.4);
            this.scene.add(this.zombieDollar);

            this.zombieDollar.originalY = 0.9;
            this.zombieDollar.velocity = 0;
            this.zombieDollar.isPetting = false;
            this.zombieDollar.name = 'Zombie Dollar';
            this.zombieDollar.bounce = () => { this.zombieDollar.velocity = 0.14; };
            this.zombieDollar.userData.noPetSound = true;
        } catch (e) {
            console.warn('setupZombieDollar failed', e);
        }
    }

    setupHouse() {
        this.houseGroup = new THREE.Group();
        this.houseGroup.position.set(4, 0, 4);
        this.scene.add(this.houseGroup);
        
        // Foundation blueprint
        const base = new THREE.Mesh(
            new THREE.PlaneGeometry(3, 3),
            new THREE.MeshStandardMaterial({ color: 0x444444, transparent: true, opacity: 0.5 })
        );
        base.rotation.x = -Math.PI / 2;
        base.position.y = 0.01;
        this.houseGroup.add(base);
    }

    // Apply or remove Christmas visual changes (snowy ground, fog tint, light snow plane)
    applyChristmas(enabled) {
        try {
            if (enabled) {
                // tint sky to pale winter blue and increase fog
                this.scene.background = new THREE.Color(0xE6F3FF);
                this.scene.fog = new THREE.FogExp2(0xE6F3FF, 0.02);
                // gently tint vegetation materials (if present)
                if (this._vegetationItems && this._vegetationItems.length) {
                    this._vegetationItems.forEach(item => {
                        try {
                            if (item.material && item.material.color) {
                                item.material.color.lerp(new THREE.Color(0xCFEFEF), 0.3);
                            } else if (item.children) {
                                item.children.forEach(c => {
                                    if (c.material && c.material.color) c.material.color.lerp(new THREE.Color(0xCFEFEF), 0.3);
                                });
                            }
                        } catch (e) {}
                    });
                }
                // add a light snow plane overlay (subtle)
                if (!this._snowPlane) {
                    const snowMat = new THREE.MeshStandardMaterial({ color: 0xFFFFFF, transparent: true, opacity: 0.85 });
                    const snow = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), snowMat);
                    snow.rotation.x = -Math.PI / 2;
                    snow.position.y = 0.06;
                    snow.receiveShadow = false;
                    this._snowPlane = snow;
                    this.scene.add(this._snowPlane);
                }
            } else {
                // restore default sky and fog
                this.scene.background = new THREE.Color(0x87CEEB);
                this.scene.fog = new THREE.Fog(0x87CEEB, 20, 50);
                // remove snow plane if present
                if (this._snowPlane) {
                    try { this.scene.remove(this._snowPlane); } catch (e) {}
                    this._snowPlane = null;
                }
                // attempt to reset vegetation tint by rebuilding vegetation
                this.rebuildVegetation();
            }
        } catch (e) {
            console.warn('applyChristmas failed', e);
        }
    }

    showGBeam(targetPos) {
        const points = [this.builderG.position.clone(), targetPos.clone()];
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const material = new THREE.LineBasicMaterial({ color: 0x00ffff, linewidth: 5 });
        const line = new THREE.Line(geometry, material);
        this.scene.add(line);
        setTimeout(() => this.scene.remove(line), 100);
    }

    advanceGrowth(day) {
        this.plantGroup.clear();

        if (day === 1) {
            const seed = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 8), new THREE.MeshStandardMaterial({ color: 0x8B4513 }));
            this.plantGroup.add(seed);
        } else if (day === 2) {
            const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.5), new THREE.MeshStandardMaterial({ color: 0x228B22 }));
            stem.position.y = 0.25;
            this.plantGroup.add(stem);
        } else if (day === 3) {
            const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1), new THREE.MeshStandardMaterial({ color: 0x228B22 }));
            stem.position.y = 0.5;
            const leaves = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 8), new THREE.MeshStandardMaterial({ color: 0x32CD32 }));
            leaves.position.y = 1;
            this.plantGroup.add(stem, leaves);
        } else if (day === 4) {
            const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 2), new THREE.MeshStandardMaterial({ color: 0x228B22 }));
            stem.position.y = 1;
            const leaves = new THREE.Mesh(new THREE.SphereGeometry(0.8, 12, 12), new THREE.MeshStandardMaterial({ color: 0x32CD32 }));
            leaves.position.y = 2;
            this.plantGroup.add(stem, leaves);
        } else if (day >= 5) {
            const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, 3 + (day - 5)), new THREE.MeshStandardMaterial({ color: 0x8B4513 }));
            trunk.position.y = (3 + (day - 5)) / 2;
            const canopy = new THREE.Mesh(new THREE.SphereGeometry(1.5 + (day - 5) * 0.2, 16, 16), new THREE.MeshStandardMaterial({ color: 0x006400 }));
            canopy.position.y = 3.5 + (day - 5);
            this.plantGroup.add(trunk, canopy);
            
            for(let i=0; i<5 + (day-5)*2; i++) {
                const fruit = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 8), new THREE.MeshStandardMaterial({color: 0xff0000}));
                fruit.position.set(Math.sin(i)*1.2, 3.5 + (day-5) + Math.cos(i)*0.6, Math.cos(i)*1.2);
                this.plantGroup.add(fruit);
            }
        }
    }

    advanceHouse(day) {
        this.houseGroup.clear();
        
        const woodMat = new THREE.MeshStandardMaterial({ color: 0x8B4513 });
        const wallMat = new THREE.MeshStandardMaterial({ color: 0xEADDCA });
        const roofMat = new THREE.MeshStandardMaterial({ color: 0x800000 });

        if (day === 1) {
            const blueprint = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), new THREE.MeshStandardMaterial({ color: 0x4444ff, transparent: true, opacity: 0.3 }));
            blueprint.rotation.x = -Math.PI / 2;
            blueprint.position.y = 0.01;
            this.houseGroup.add(blueprint);
        } else if (day === 2) {
            const base = new THREE.Mesh(new THREE.BoxGeometry(3, 0.2, 3), woodMat);
            base.position.y = 0.1;
            this.houseGroup.add(base);
        } else if (day === 3) {
            const frame = new THREE.Mesh(new THREE.BoxGeometry(3, 1, 3), woodMat);
            frame.position.y = 0.5;
            frame.material.wireframe = true;
            this.houseGroup.add(frame);
        } else if (day === 4) {
            const walls = new THREE.Mesh(new THREE.BoxGeometry(3, 2, 3), wallMat);
            walls.position.y = 1;
            this.houseGroup.add(walls);
        } else if (day === 5) {
            const walls = new THREE.Mesh(new THREE.BoxGeometry(3, 2, 3), wallMat);
            walls.position.y = 1;
            const roof = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.2, 3.5), roofMat);
            roof.position.y = 2.1;
            this.houseGroup.add(walls, roof);
        } else if (day === 6) {
            const walls = new THREE.Mesh(new THREE.BoxGeometry(3, 2, 3), wallMat);
            walls.position.y = 1;
            const roof = new THREE.Mesh(new THREE.ConeGeometry(2.5, 1.5, 4), roofMat);
            roof.position.y = 2.75;
            roof.rotation.y = Math.PI / 4;
            this.houseGroup.add(walls, roof);
        } else if (day === 7) {
            const walls = new THREE.Mesh(new THREE.BoxGeometry(3, 2, 3), wallMat);
            walls.position.y = 1;
            const roof = new THREE.Mesh(new THREE.ConeGeometry(2.5, 1.5, 4), roofMat);
            roof.position.y = 2.75;
            roof.rotation.y = Math.PI / 4;
            const door = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.2, 0.1), woodMat);
            door.position.set(0, 0.6, 1.5);
            this.houseGroup.add(walls, roof, door);
            
            const windowGeom = new THREE.BoxGeometry(0.5, 0.5, 0.1);
            const windowMat = new THREE.MeshStandardMaterial({ color: 0x87CEEB });
            const win1 = new THREE.Mesh(windowGeom, windowMat);
            win1.position.set(0.8, 1.2, 1.5);
            const win2 = new THREE.Mesh(windowGeom, windowMat);
            win2.position.set(-0.8, 1.2, 1.5);
            this.houseGroup.add(win1, win2);
        }
    }

    update(dt) {
        // Cashy / sprites bounce animation (include Chromebook)
        [this.cashy, this.builderG, this.timeG, this.dancingBanana, this.chromebook].forEach(sprite => {
            if (sprite) {
                sprite.position.y += sprite.velocity;
                sprite.velocity -= 0.015;
                if (sprite.position.y < sprite.originalY) {
                    sprite.position.y = sprite.originalY;
                    sprite.velocity = 0;
                }
            }
        });
        
        // Banana follows player if enabled
        if (this.dancingBanana && this.dancingBanana.following && this.playerPosition) {
            const dir = new THREE.Vector3().subVectors(this.playerPosition, this.dancingBanana.position);
            dir.y = 0;
            if (dir.length() > 1.5) {
                dir.normalize();
                this.dancingBanana.position.add(dir.multiplyScalar(dt * 2.5));
            }
            // little bob
            this.dancingBanana.position.y = this.dancingBanana.originalY + Math.abs(Math.sin(Date.now() * 0.01)) * 0.15;
        }

        // General world vibes
        this.plantGroup.rotation.y += dt * 0.1;

        // CapyBrothers work simulation: each worker produces a coin every workRate seconds
        if (this._capyBrothers && this._capyBrothers.length && window.game && window.game.gameState) {
            this._capyBrothers.forEach((worker) => {
                try {
                    worker.userData.workTimer -= dt;
                    // bob while working
                    worker.position.y = worker.originalY ? (worker.originalY + Math.sin(Date.now() * 0.01) * 0.06) : (0.9 + Math.sin(Date.now() * 0.01) * 0.06);
                    if (worker.userData.workTimer <= 0) {
                        // produce a coin for the global gameState
                        worker.userData.workTimer = worker.userData.workRate || (6 + Math.random() * 6);
                        // safely credit coins on the main game object
                        try {
                            window.game.gameState.coins = (window.game.gameState.coins || 0) + 1;
                            // visual coin popup near worker
                            const tex = new THREE.TextureLoader().load('/channels4_profile (6).jpg'); // small icon placeholder
                            const coin = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex }));
                            coin.scale.set(0.6,0.6,1);
                            coin.position.copy(worker.position).add(new THREE.Vector3(0,1.2,0));
                            this.scene.add(coin);
                            // float and remove
                            setTimeout(()=>{ try { this.scene.remove(coin); } catch(e){} }, 1200);
                            // update shop UI coin count if present
                            const coinEl = document.getElementById('capy-coin-count');
                            if (coinEl) coinEl.textContent = String(window.game.gameState.coins);
                        } catch (e) {}
                    }
                } catch (e) {}
            });
        }

        // Frogs update: idle bounce and simple jump timing (actual attack resolution handled in Game)
        if (this.frogs && this.frogs.length) {
            this.frogs.forEach(frog => {
                try {
                    // idle bounce
                    frog.position.y = frog.originalY + Math.abs(Math.sin(Date.now() * 0.01 + (frog.userData?.phase || 0))) * 0.08;

                    // countdown for jump readiness
                    frog.jumpTimer -= dt;
                    if (frog.jumpTimer <= 0 && !frog.isAirborne) {
                        // initiate jump
                        frog.isAirborne = true;
                        frog.jumpStart = Date.now();
                        frog.jumpDuration = 0.35 + Math.random() * 0.35;
                        frog.jumpTimer = frog.jumpCooldown + Math.random() * 1.2;
                    }

                    // if airborne, compute simple arc
                    if (frog.isAirborne) {
                        const elapsed = (Date.now() - (frog.jumpStart || 0)) / 1000;
                        const t = Math.min(1, elapsed / (frog.jumpDuration || 0.5));
                        const h = frog.jumpStrength;
                        const y = frog.originalY + 4 * h * t * (1 - t);
                        frog.position.y = y;
                        if (t >= 1) {
                            frog.isAirborne = false;
                            frog.position.y = frog.originalY;
                        }
                    }
                } catch (e) {}
            });
        }

        // Builder G attacks nearby poison dart frogs: remove hostile frogs that get too close
        try {
            if (this.builderG && Array.isArray(this._poisonFrogs) && this._poisonFrogs.length) {
                const removed = [];
                const bgPos = this.builderG.position;
                for (const pf of Array.from(this._poisonFrogs)) {
                    try {
                        if (!pf || !pf.position) continue;
                        const d = bgPos.distanceTo(pf.position);
                        // if frog is within attack range, Builder G "attacks" and removes it
                        if (d < 2.6) {
                            // visual: small bounce on Builder G to indicate attack
                            try { this.builderG.velocity = 0.22; } catch(e){}
                            // mark removed and take frog out of scene
                            try { this.scene.remove(pf); } catch(e){}
                            removed.push(pf);
                            // optional announcement via DOM if game exists
                            try {
                                if (window.game && window.game._announcementText) {
                                    window.game._announcementText.textContent = "Builder G foiled a Poison Dart Frog!";
                                    setTimeout(()=>{ try{ window.game._announcementText.textContent = 'UPDATES MORE SOON!'; }catch(e){} }, 1600);
                                }
                            } catch(e){}
                        }
                    } catch (e) {}
                }
                // filter out removed frogs from array
                if (removed.length) {
                    this._poisonFrogs = this._poisonFrogs.filter(p => !removed.includes(p));
                }
            }
        } catch (e) {
            console.warn('Builder G attack handling failed', e);
        }
    }
}