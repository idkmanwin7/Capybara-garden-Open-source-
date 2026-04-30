import * as THREE from 'three';
import { GardenWorld } from './World.js';
import { Player } from './Player.js';
import { Enemy } from './Enemy.js';
import nipplejs from 'nipplejs';

class Game {
    constructor() {
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.shadowMap.enabled = true;
        document.body.appendChild(this.renderer.domElement);

        this.world = new GardenWorld(this.scene);
        this.player = new Player(this.scene);
        
        this.camera.position.set(0, 10, 10);
        this.camera.lookAt(0, 0, 0);

        this.input = { x: 0, y: 0, isDown: false };
        this.setupControls();
        
        this.gameState = {
            day: 1,
            maxDays: 7,
            dayDuration: 25, // seconds
            timer: 0,
            pets: 0,
            plantProgress: 0,
            isSurvival: false,
            gameOver: false
        };
        this.enemies = [];
        this.enemySpawnTimer = 0;

        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        this.sounds = {};
        this.loadSounds();

        this.animate = this.animate.bind(this);
        requestAnimationFrame(this.animate);

        window.addEventListener('resize', () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        });
    }

    async loadSounds() {
        const soundFiles = {
            pet: 'pet_sound.mp3',
            plant: 'plant_sound.mp3',
            day: 'day_change.mp3'
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
        const source = this.audioContext.createBufferSource();
        source.buffer = this.sounds[name];
        source.connect(this.audioContext.destination);
        source.start(0);
    }

    setupControls() {
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

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

    updateGameState(dt) {
        if (this.gameState.gameOver) return;

        // Check for interaction with Time G (videoframe_1086.png)
        const pPos = this.player.mesh.position;
        const timeGDist = pPos.distanceTo(this.world.timeG.position);
        let timeMultiplier = 1;
        if (timeGDist < 2.5) {
            timeMultiplier = 5; // 5x speed when near Time G
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
            if (this.enemySpawnTimer > 3) {
                this.enemySpawnTimer = 0;
                const angle = Math.random() * Math.PI * 2;
                const spawnPos = new THREE.Vector3(Math.cos(angle) * 20, 0, Math.sin(angle) * 20);
                this.enemies.push(new Enemy(this.scene, spawnPos));
            }

            // Move enemies and check pet death
            this.enemies.forEach(enemy => {
                if (!enemy.alive) return;
                enemy.update(this.world.cashy.position, dt);
                
                const distToCashy = enemy.mesh.position.distanceTo(this.world.cashy.position);
                if (distToCashy < 1) {
                    this.gameState.gameOver = true;
                    document.getElementById('instructions').innerHTML = "GAME OVER<br>Cashy was captured! Refresh to restart.";
                }
            });

            // G-Defense logic
            const pPos = this.player.mesh.position;
            const distToG = pPos.distanceTo(this.world.builderG.position);
            if (distToG < 2.5) {
                this.world.builderG.material.color.setHex(0x00ffff);
                // Find nearest enemy to kill
                const target = this.enemies.find(e => e.alive && e.mesh.position.distanceTo(this.world.builderG.position) < 10);
                if (target) {
                    this.world.showGBeam(target.mesh.position);
                    target.destroy();
                    this.playSound('plant'); // Use rustle sound as pop
                }
            } else {
                this.world.builderG.material.color.setHex(0xffffff);
            }
        }

        // Check for interactions
        const cashyDist = pPos.distanceTo(this.world.cashy.position);
        if (cashyDist < 1.5 && !this.world.cashy.isPetting) {
            this.world.cashy.isPetting = true;
            this.gameState.pets++;
            document.getElementById('pet-counter').textContent = this.gameState.pets;
            this.playSound('pet');
            this.world.cashy.bounce();
            setTimeout(() => { this.world.cashy.isPetting = false; }, 1000);
        }

        // Interaction with Builder G
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

    animate() {
        requestAnimationFrame(this.animate);
        const dt = 0.016; // Approx 60fps

        this.player.update(this.input, dt);
        this.world.update(dt);
        this.updateGameState(dt);

        // Smooth camera follow
        const targetCamPos = this.player.mesh.position.clone().add(new THREE.Vector3(0, 12, 12));
        this.camera.position.lerp(targetCamPos, 0.1);
        this.camera.lookAt(this.player.mesh.position);

        this.renderer.render(this.scene, this.camera);
    }
}

new Game();