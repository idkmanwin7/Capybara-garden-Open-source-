import * as THREE from 'three';

export class GardenWorld {
    constructor(scene) {
        this.scene = scene;
        this.setupLights();
        this.setupGround();
        this.setupCashy();
        this.setupPlant();
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
            this.cashy.velocity = 0.2;
        };
        this.cashy.velocity = 0;
    }

    setupPlant() {
        this.plantGroup = new THREE.Group();
        this.plantGroup.position.set(3, 0, -2);
        this.scene.add(this.plantGroup);

        this.plant = new THREE.Mesh(
            new THREE.SphereGeometry(0.2, 16, 16),
            new THREE.MeshStandardMaterial({ color: 0x8B4513 }) // Brown for seed
        );
        this.plantGroup.add(this.plant);
        this.currentDay = 1;
    }

    advanceGrowth(day) {
        this.currentDay = day;
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
        } else {
            const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, 3), new THREE.MeshStandardMaterial({ color: 0x8B4513 }));
            trunk.position.y = 1.5;
            const canopy = new THREE.Mesh(new THREE.SphereGeometry(1.5, 16, 16), new THREE.MeshStandardMaterial({ color: 0x006400 }));
            canopy.position.y = 3.5;
            this.plantGroup.add(trunk, canopy);
            
            // Add some "fruits"
            for(let i=0; i<5; i++) {
                const fruit = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 8), new THREE.MeshStandardMaterial({color: 0xff0000}));
                fruit.position.set(Math.sin(i)*1, 3.5 + Math.cos(i)*0.5, Math.cos(i)*1);
                this.plantGroup.add(fruit);
            }
        }
    }

    update(dt) {
        // Cashy bounce animation
        if (this.cashy) {
            this.cashy.position.y += this.cashy.velocity;
            this.cashy.velocity -= 0.015;
            if (this.cashy.position.y < this.cashy.originalY) {
                this.cashy.position.y = this.cashy.originalY;
                this.cashy.velocity = 0;
            }
        }
        
        // General world vibes
        this.plantGroup.rotation.y += dt * 0.2;
    }
}