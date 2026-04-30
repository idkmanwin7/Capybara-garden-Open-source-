import * as THREE from 'three';

export class GardenWorld {
    constructor(scene) {
        this.scene = scene;
        this.setupLights();
        this.setupGround();
        this.setupCashy();
        this.setupBuilderG();
        this.setupTimeG();
        this.setupPlant();
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

        // Add some flowers/grass tufts
        for (let i = 0; i < 40; i++) {
            const flower = new THREE.Mesh(
                new THREE.SphereGeometry(0.1, 8, 8),
                new THREE.MeshStandardMaterial({ color: Math.random() > 0.5 ? 0xffcc00 : 0xffffff })
            );
            flower.position.set(Math.random() * 40 - 20, 0.1, Math.random() * 40 - 20);
            this.scene.add(flower);
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
        const gTex = textureLoader.load('/channels4_profile (4).jpg');
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
        // Cashy bounce animation
        [this.cashy, this.builderG, this.timeG].forEach(sprite => {
            if (sprite) {
                sprite.position.y += sprite.velocity;
                sprite.velocity -= 0.015;
                if (sprite.position.y < sprite.originalY) {
                    sprite.position.y = sprite.originalY;
                    sprite.velocity = 0;
                }
            }
        });
        
        // General world vibes
        this.plantGroup.rotation.y += dt * 0.1;
    }
}