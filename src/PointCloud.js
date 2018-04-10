function RSMPointCloud(_size, _LPVGridSize) {
    this.size = _size || 4096;
    this.framebufferSize = _LPVGridSize || 128;
    this.injectionFramebuffer = this.createFramebuffer(this.framebufferSize);
    this.propagationFramebuffer = this.createFramebuffer(this.framebufferSize);
}

RSMPointCloud.prototype = {
    constructor: RSMPointCloud,

    createInjectionPointCloud: function() {
        const positionData = new Float32Array(this.size * this.size * 2);

        let positionIndex = 0;
        for (let x = 0; x < this.size; x++) {
            for (let y = 0; y < this.size; y++) {
                positionData[positionIndex++] = x;
                positionData[positionIndex++] = y;
            }
        }

        const pointPositions = app.createVertexBuffer(PicoGL.FLOAT, 2, positionData);

        const pointArray = app.createVertexArray()
        .vertexAttributeBuffer(0, pointPositions);

        return pointArray;
    },

    createPropagationPointCloud: function() {
        const positionData = new Float32Array(this.framebufferSize * this.framebufferSize * this.framebufferSize * 2);
        let positionIndex = 0;
        for(let x = 0; x < this.framebufferSize * this.framebufferSize; x++) {
            for(let y = 0; y < this.framebufferSize; y++) {
                positionData[positionIndex++] = x;
                positionData[positionIndex++] = y;
            }
        }

        const pointPositions = app.createVertexBuffer(PicoGL.FLOAT, 2, positionData);

        const pointArray = app.createVertexArray()
        .vertexAttributeBuffer(0, pointPositions);

        return pointArray;
    },

    //since these two are identical (right now) we could use one function for both of these
    createInjectionDrawCall: function(_shader) {
    this.injectionDrawCall = app.createDrawCall(_shader, this.createInjectionPointCloud(), PicoGL.POINTS);
        
        return this.injectionDrawCall;
    },

    createPropagationDrawCall: function(_shader) {
        this.propagationDrawCall = app.createDrawCall(_shader, this.createPropagationPointCloud(), PicoGL.POINTS);

        return this.propagationDrawCall;
    },

    createFramebuffer: function(_size) {
        const redBuffer = app.createTexture2D(_size * _size, _size);
        const greenBuffer = app.createTexture2D(_size * _size, _size);
        const blueBuffer = app.createTexture2D(_size * _size, _size);

        const framebuffer = app.createFramebuffer()
        .colorTarget(0, redBuffer)
        .colorTarget(1, greenBuffer)
        .colorTarget(2, blueBuffer);

        return framebuffer;
    },

    lightInjection(_RSMFrameBuffer) {
        this.injectionFinished = false;

        if(_RSMFrameBuffer) {
            const rsmFlux = _RSMFrameBuffer.colorTextures[0];
            const rsmPositions = _RSMFrameBuffer.colorTextures[1];
            const rsmNormals = _RSMFrameBuffer.colorTextures[2];

            if (this.injectionDrawCall && this.injectionFramebuffer) {
               app.drawFramebuffer(this.injectionFramebuffer)
	            .viewport(0, 0, this.framebufferSize * this.framebufferSize, this.framebufferSize)
	            .depthTest()
	            .depthFunc(PicoGL.LEQUAL)
	            .noBlend()
	            .clear();

               //rsmFlux[0][0] = vec2.create(); //(0,0) //gives errors
                this.injectionDrawCall
                .texture('u_rsm_flux', rsmFlux)
                .texture('u_rsm_world_positions', rsmPositions)
                .texture('u_rsm_world_normals', rsmNormals)
                .uniform('u_rsm_size', this.size)
                .uniform('u_texture_size', this.framebufferSize)
                //.uniform('u_light_direction', directionalLight.direction)
                //.uniform('u_world_from_local', mat4.create())
	    	    //.uniform('u_view_from_world', camera.viewMatrix)
                //.uniform('u_projection_from_view', camera.projectionMatrix)
                .draw();

                this.injectionFinished = true;
            }
        }
    },

    lightPropagation() {
        if (this.propagationDrawCall && this.injectionFramebuffer && this.propagationFramebuffer && this.injectionFinished) {
            app.drawFramebuffer(this.propagationFramebuffer)
                .viewport(0, 0, this.framebufferSize * this.framebufferSize, this.framebufferSize)
                .depthTest()
                .depthFunc(PicoGL.LEQUAL)
                .noBlend()
                .clear();

            this.propagationDrawCall
                .texture('u_red_contribution', this.injectionFramebuffer.colorTextures[0])
                .texture('u_green_contribution', this.injectionFramebuffer.colorTextures[1])
                .texture('u_blue_contribution', this.injectionFramebuffer.colorTextures[2])
                .uniform('u_grid_size', this.framebufferSize)
                .draw();
        }
    }
};