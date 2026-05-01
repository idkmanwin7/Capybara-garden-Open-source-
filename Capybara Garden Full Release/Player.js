import * as THREE from 'three';

export class Player {
    constructor(scene) {
        this.scene = scene;
        this.mesh = this.createCapybaraMesh();
        this.scene.add(this.mesh);
        
        this.speed = 5;
        this.rotationSpeed = 10;
        this.targetRotation = 0;
    }

    createCapybaraMesh() {
        const group = new THREE.Group();

        // Body - solid color material (no texture)
        const bodyMat = new THREE.MeshStandardMaterial({ color: 0x8B4513 });
        const body = new THREE.Mesh(
            new THREE.BoxGeometry(0.8, 0.6, 1.2),
            bodyMat
        );
        body.position.y = 0.4;
        body.castShadow = true;
        group.add(body);

        // Head
        const head = new THREE.Mesh(
            new THREE.BoxGeometry(0.5, 0.5, 0.5),
            new THREE.MeshStandardMaterial({ color: 0x8B4513 })
        );
        head.position.set(0, 0.7, 0.6);
        group.add(head);

        // Ears
        const earGeom = new THREE.BoxGeometry(0.1, 0.1, 0.1);
        const earMat = new THREE.MeshStandardMaterial({ color: 0x5D2906 });
        const earL = new THREE.Mesh(earGeom, earMat);
        earL.position.set(0.2, 1.0, 0.5);
        const earR = earL.clone();
        earR.material = earMat;
        earR.position.x = -0.2;
        group.add(earL, earR);

        // Legs
        const legGeom = new THREE.BoxGeometry(0.15, 0.3, 0.15);
        const legMaterial = new THREE.MeshStandardMaterial({ color: 0x5D2906 });
        const positions = [
            [0.3, 0.15, 0.4], [-0.3, 0.15, 0.4],
            [0.3, 0.15, -0.4], [-0.3, 0.15, -0.4]
        ];
        positions.forEach(pos => {
            const leg = new THREE.Mesh(legGeom, legMaterial);
            leg.position.set(...pos);
            group.add(leg);
        });

        return group;
    }

    update(input, dt) {
        if (input.isDown) {
            // Move toward input vector
            // input.x and input.y are normalized screenspace/joystick -1 to 1
            const moveDir = new THREE.Vector3(input.x, 0, input.y).normalize();
            
            // Apply movement
            this.mesh.position.add(moveDir.multiplyScalar(this.speed * dt));
            
            // Rotation towards move direction
            this.targetRotation = Math.atan2(input.x, input.y);
            
            // Smoothly rotate mesh
            let diff = this.targetRotation - this.mesh.rotation.y;
            while (diff < -Math.PI) diff += Math.PI * 2;
            while (diff > Math.PI) diff -= Math.PI * 2;
            this.mesh.rotation.y += diff * this.rotationSpeed * dt;

            // Simple walk bob
            this.mesh.position.y = 0.1 + Math.abs(Math.sin(Date.now() * 0.01)) * 0.1;
        } else {
            this.mesh.position.y = THREE.MathUtils.lerp(this.mesh.position.y, 0, 0.1);
        }
    }
}