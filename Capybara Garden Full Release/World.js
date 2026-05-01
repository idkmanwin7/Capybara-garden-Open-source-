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
        this.setupChromebookGuy();
        this.setupJackOLantern();
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
        const material = new THREE.MeshStandardMaterial({ color: 0x567d46 });
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
    }

    setupBuilderG() {
        const textureLoader = new THREE.TextureLoader();
        const gTex = textureLoader.load('/channels4_profile (5).jpg');
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

    setupChromebookGuy() {
        // Add the Chromebook Guy pet sprite (no pet sound on interactions)
        try {
            const loader = new THREE.TextureLoader();
            const tex = loader.load('/chromebookguy.png');
            const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
            this.chromebookGuy = new THREE.Sprite(mat);
            this.chromebookGuy.scale.set(1.6, 1.6, 1);
            // place somewhere near builderG area
            this.chromebookGuy.position.set(-1.5, 1, 1.5);
            this.chromebookGuy.originalY = 1;
            this.chromebookGuy.velocity = 0;
            this.chromebookGuy.isPetting = false;
            this.scene.add(this.chromebookGuy);
        } catch (e) {
            console.warn('Failed to create Chromebook Guy sprite', e);
        }
    }

    setupJackOLantern() {
        try {
            const loader = new THREE.TextureLoader();
            const tex = loader.load('/Jack O Lantern.png');
            const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
            this.jackLantern = new THREE.Sprite(mat);
            this.jackLantern.scale.set(1.6, 1.6, 1);
            // place near center with some random offset
            this.jackLantern.position.set(1 + (Math.random()-0.5)*4, 0.8, -1 + (Math.random()-0.5)*4);
            this.jackLantern.originalY = 0.8;
            this.jackLantern.visible = true;
            this.scene.add(this.jackLantern);
        } catch (e) {
            console.warn('Failed to create Jack O Lantern sprite', e);
        }
    }

    // Optional Halloween visual toggle (called by game)
    applyHalloween(enabled) {
        try {
            if (enabled) {
                // subtle orange tint in sky and spawn lantern if missing
                this.scene.background = new THREE.Color(0xFFCC99);
                this.scene.fog = new THREE.FogExp2(0xFFCC99, 0.015);
                if (!this.jackLantern) this.setupJackOLantern();
            } else {
                // restore sky if not christmas
                this.scene.background = new THREE.Color(0x87CEEB);
                this.scene.fog = new THREE.Fog(0x87CEEB, 20, 50);
                if (this.jackLantern) {
                    try { this.scene.remove(this.jackLantern); } catch(e){}
                    this.jackLantern = null;
                }
            }
        } catch (e) {
            console.warn('applyHalloween failed', e);
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
        // Cashy / sprites bounce animation
        [this.cashy, this.builderG, this.timeG, this.dancingBanana].forEach(sprite => {
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
    }
}