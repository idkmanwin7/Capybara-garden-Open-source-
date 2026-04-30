import * as THREE from 'three';

export class Enemy {
    constructor(scene, startPos) {
        this.scene = scene;
        this.alive = true;
        this.speed = 2.5;
        this.mesh = this.createEnemyMesh();
        this.mesh.position.copy(startPos);
        this.mesh.position.y = 1.5;
        this.scene.add(this.mesh);
    }

    createEnemyMesh() {
        const textureLoader = new THREE.TextureLoader();
        const faceTex = textureLoader.load('/unused png.png');
        const material = new THREE.SpriteMaterial({ map: faceTex, color: 0xff0000 });
        const sprite = new THREE.Sprite(material);
        sprite.scale.set(1.5, 1.5, 1);
        return sprite;
    }

    update(targetPos, dt) {
        if (!this.alive) return;
        
        const dir = new THREE.Vector3().subVectors(targetPos, this.mesh.position).normalize();
        dir.y = 0; // Keep on ground plane
        this.mesh.position.add(dir.multiplyScalar(this.speed * dt));
        
        // Hover effect
        this.mesh.position.y = 1.2 + Math.sin(Date.now() * 0.005) * 0.2;
    }

    destroy() {
        this.alive = false;
        this.scene.remove(this.mesh);
    }
}