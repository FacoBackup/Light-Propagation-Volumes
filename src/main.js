'using strict';
var stats;
var gui;
var settings = {
    target_fps: 60,
    environment_brightness: 1.5,

    rotate_light: false,

    indirect_light_attenuation: 1.0,
    ambient_light: 0.0,
    render_lpv_debug_view: false,
    render_direct_light: true,
    render_indirect_light: false,
};
var sceneSettings = {
    ambientColor: new Float32Array([0.15, 0.15, 0.15, 1.0]),
};
var app;
var gpuTimePanel;
var picoTimer;
var defaultShader;
var rsmShader;
var simpleShadowMapShader;
var LPV;
var blitTextureDrawCall;
var environmentDrawCall;
var sceneUniforms;
var shadowMapSize = 4096;
var shadowMapFramebuffer;
var shadowMapSmallSize = 512;
var rsmFramebuffers = [];
var sponza = true;
var initLPV = false;
var lpvGridSize;
var propagationIterations;
var offsetX;
var offsetY;
var offsetZ;
if (sponza) {
    lpvGridSize = 32;
    propagationIterations = 64;
    offsetX = 0;
    offsetY = 1.5;
    offsetZ = 0;
} else {
    lpvGridSize = 32;
    propagationIterations = 64;
    offsetX = 0;
    offsetY = -1;
    offsetZ = -4.5;
}
var camera;
var directionalLight;
var spotLight;
var lightSources = [];
var meshes = [];
var texturesLoaded = 0;
var probeDrawCall;

window.addEventListener('DOMContentLoaded', function () {

    init();
    resize();

    window.addEventListener('resize', resize, false);
    requestAnimationFrame(render);

}, false);


const checkWebGL2Compability = () => true

function makeSingleColorTexture(color) {
    var options = {};
    options['minFilter'] = PicoGL.NEAREST;
    options['magFilter'] = PicoGL.NEAREST;
    options['mipmaps'] = false;
    options['format'] = PicoGL.RGB;
    options['internalFormat'] = PicoGL.RGB32F;
    options['type'] = PicoGL.FLOAT;
    var side = 32;
    var arr = [];
    for (var i = 0; i < side * side; i++) {
        arr = arr.concat(color);
    }
    var image_data = new Float32Array(arr);
    return app.createTexture2D(image_data, side, side, options);
}

function isDataTexture(imageName) {
    return imageName.indexOf('_ddn') != -1
        || imageName.indexOf('_spec') != -1
        || imageName.indexOf('_normal') != -1;
}

function loadTexture(imageName, options) {

    if (!options) {

        var options = {};
        options['minFilter'] = PicoGL.LINEAR_MIPMAP_NEAREST;
        options['magFilter'] = PicoGL.LINEAR;
        options['mipmaps'] = true;

        if (isDataTexture(imageName)) {
            options['internalFormat'] = PicoGL.RGB8;
            options['format'] = PicoGL.RGB;
        } else {
            options['internalFormat'] = PicoGL.SRGB8_ALPHA8;
            options['format'] = PicoGL.RGBA;
        }
    }

    var texture = app.createTexture2D(1, 1, options);
    texture.data(new Uint8Array([200, 200, 200, 256]));

    var image = document.createElement('img');
    image.onload = function () {

        texture.resize(image.width, image.height);
        texture.data(image);
        texturesLoaded++;
    };
    image.src = 'assets/' + imageName;
    return texture;

}

function makeShader(name, shaderLoaderData) {

    var programData = shaderLoaderData[name];
    var program = app.createProgram(programData.vertexSource, programData.fragmentSource);
    return program;

}

function loadObject(directory, objFilename, mtlFilename, modelMatrix) {

    var objLoader = new OBJLoader();
    var mtlLoader = new MTLLoader();

    var path = 'assets/' + directory;

    objLoader.load(path + objFilename, function (objects) {
        mtlLoader.load(path + mtlFilename, function (materials) {
            objects.forEach(function (object) {

                var material = materials[object.material];
                var diffuseTexture;
                if (material.properties.map_Kd) {
                    diffuseTexture = loadTexture(directory + material.properties.map_Kd);
                } else {
                    diffuseTexture = makeSingleColorTexture(material.properties.Kd);
                }
                var specularMap = (material.properties.map_Ks) ? directory + material.properties.map_Ks : 'default_specular.jpg';
                var normalMap = (material.properties.map_norm) ? directory + material.properties.map_norm : 'default_normal.jpg';

                var vertexArray = createVertexArrayFromMeshInfo(object);

                var drawCall = app.createDrawCall(defaultShader, vertexArray)
                    .uniformBlock('SceneUniforms', sceneUniforms)
                    .texture('u_diffuse_map', diffuseTexture)
                    .texture('u_specular_map', loadTexture(specularMap))
                    .texture('u_normal_map', loadTexture(normalMap));

                var shadowMappingDrawCall = app.createDrawCall(simpleShadowMapShader, vertexArray);

                var rsmDrawCall = app.createDrawCall(rsmShader, vertexArray)
                    .texture('u_diffuse_map', diffuseTexture);

                meshes.push({
                    modelMatrix: modelMatrix || mat4.create(),
                    drawCall: drawCall,
                    shadowMapDrawCall: shadowMappingDrawCall,
                    rsmDrawCall: rsmDrawCall
                });

            });
        });
    });
    renderShadowMap();
}


function init() {

    if (!checkWebGL2Compability()) {
        return;
    }

    var canvas = document.getElementById('canvas');
    app = PicoGL.createApp(canvas, {antialias: false});
    app.floatRenderTargets();

    stats = new Stats();

    document.body.appendChild(stats.dom);




    gui = new dat.GUI();

    gui.add(settings, 'ambient_light').name('Ambient light');
    gui.add(settings, 'indirect_light_attenuation').name('Indirect light attenuation');
    gui.add(settings, 'render_direct_light').name('Direct light');
    gui.add(settings, 'render_indirect_light').name('Indirect light');

    app.clearColor(0, 0, 0, 0);
    app.cullBackfaces();
    app.noBlend();

    var cameraPos = vec3.fromValues(-15 + offsetX, 3 + offsetY, 0 + offsetZ);
    var cameraRot = quat.fromEuler(quat.create(), 15, -90, 0);

    camera = new Camera(cameraPos, cameraRot);


    addDirectionalLight(vec3.fromValues(-0.2, -1.0, 0.333), new Float32Array([13.0, 13.0, 13.0]));

    directionalLight = lightSources[0].source;

    shadowMapFramebuffer = setupDirectionalLightShadowMapFramebuffer(shadowMapSize);
    for (var i = 0; i < lightSources.length; i++) {
        rsmFramebuffers.push(setupRSMFramebuffer(shadowMapSmallSize));
    }

    setupSceneUniforms();

    LPV = new LPV(shadowMapSmallSize, lpvGridSize);

    var shaderLoader = new ShaderLoader('src/shaders/');
    shaderLoader.addShaderFile('common.glsl');
    shaderLoader.addShaderFile('scene_uniforms.glsl');
    shaderLoader.addShaderFile('mesh_attributes.glsl');
    shaderLoader.addShaderFile('lpv_common.glsl');
    shaderLoader.addShaderProgram('default', 'default.vert.glsl', 'default.frag.glsl');
    shaderLoader.addShaderProgram('shadowMapping', 'shadow_mapping.vert.glsl', 'shadow_mapping.frag.glsl');
    shaderLoader.addShaderProgram('RSM', 'lpv/reflective_shadow_map.vert.glsl', 'lpv/reflective_shadow_map.frag.glsl');
    shaderLoader.addShaderProgram('lightInjection', 'lpv/light_injection.vert.glsl', 'lpv/light_injection.frag.glsl');
    shaderLoader.addShaderProgram('lightPropagation', 'lpv/light_propagation.vert.glsl', 'lpv/light_propagation.frag.glsl');
    shaderLoader.addShaderProgram('geometryInjection', 'lpv/geometry_injection.vert.glsl', 'lpv/geometry_injection.frag.glsl');


    shaderLoader.load(function (data) {
        var lightInjectShader = makeShader('lightInjection', data);
        var geometryInjectShader = makeShader('geometryInjection', data);
        var lightPropagationShader = makeShader('lightPropagation', data);
        LPV.createInjectionDrawCall(lightInjectShader);
        LPV.createGeometryInjectDrawCall(geometryInjectShader);
        LPV.createPropagationDrawCall(lightPropagationShader);


        defaultShader = makeShader('default', data);
        rsmShader = makeShader('RSM', data);
        simpleShadowMapShader = makeShader('shadowMapping', data);

        let m = mat4.create();
        let r = quat.fromEuler(quat.create(), 0, 0, 0);
        let t = vec3.fromValues(offsetX, offsetY, offsetZ);
        let s = vec3.fromValues(1, 1, 1);
        mat4.fromRotationTranslationScale(m, r, t, s);
        loadObject('sponza_with_teapot/', 'sponza_with_teapot.obj', 'sponza_with_teapot.mtl', m);

    });

}
function addDirectionalLight(direction, color) {
    lightSources.push({'source': new DirectionalLight(direction, color), 'type': 'DIRECTIONAL_LIGHT'});
}
function setupDirectionalLightShadowMapFramebuffer(size) {
    var colorBuffer = app.createTexture2D(size, size, {
        format: PicoGL.RED,
        internalFormat: PicoGL.R16F,
        type: PicoGL.FLOAT,
        minFilter: PicoGL.NEAREST,
        magFilter: PicoGL.NEAREST
    });

    var depthBuffer = app.createTexture2D(size, size, {
        format: PicoGL.DEPTH_COMPONENT,
        internalFormat: PicoGL.DEPTH_COMPONENT32F
    });

    var framebuffer = app.createFramebuffer()
        .colorTarget(0, colorBuffer)
        .depthTarget(depthBuffer);

    return framebuffer;
}
function setupRSMFramebuffer(size) {
    var colorBuffer = app.createTexture2D(size, size, {
        type: PicoGL.FLOAT,
        internalFormat: PicoGL.RBGA32F,
        minFilter: PicoGL.NEAREST,
        magFilter: PicoGL.NEAREST,
        generateMipmaps: true
    });
    var positionBuffer = app.createTexture2D(size, size, {
        type: PicoGL.FLOAT,
        internalFormat: PicoGL.RBGA32F,
        minFilter: PicoGL.NEAREST,
        magFilter: PicoGL.NEAREST,
        generateMipmaps: true
    });
    var normalBuffer = app.createTexture2D(size, size, {
        type: PicoGL.FLOAT,
        internalFormat: PicoGL.RBGA32F,
        minFilter: PicoGL.NEAREST,
        magFilter: PicoGL.NEAREST,
        generateMipmaps: true
    });
    var depthBuffer = app.createTexture2D(size, size, {
        type: PicoGL.FLOAT,
        internalFormat: PicoGL.RBGA32F,
        format: PicoGL.DEPTH_COMPONENT
    });
    var framebuffer = app.createFramebuffer()
        .colorTarget(0, colorBuffer)
        .colorTarget(1, positionBuffer)
        .colorTarget(2, normalBuffer)
        .depthTarget(depthBuffer);

    return framebuffer;
}
function setupSceneUniforms() {
    sceneUniforms = app.createUniformBuffer([
        PicoGL.FLOAT_VEC4
    ])
        .set(0, sceneSettings.ambientColor)
        .update();
}
function createVertexArrayFromMeshInfo(meshInfo) {
    var positions = app.createVertexBuffer(PicoGL.FLOAT, 3, meshInfo.positions);
    var normals = app.createVertexBuffer(PicoGL.FLOAT, 3, meshInfo.normals);
    var tangents = app.createVertexBuffer(PicoGL.FLOAT, 4, meshInfo.tangents);
    var texCoords = app.createVertexBuffer(PicoGL.FLOAT, 2, meshInfo.uvs);

    var vertexArray = app.createVertexArray()
        .vertexAttributeBuffer(0, positions)
        .vertexAttributeBuffer(1, normals)
        .vertexAttributeBuffer(2, texCoords)
        .vertexAttributeBuffer(3, tangents);

    return vertexArray;

}
function resize() {

    var w = innerWidth;
    var h = innerHeight;

    app.resize(w, h);
    camera.resize(w, h);

}


////////////////////////////////////////////////////////////////////////////////
// Rendering

function render() {
    var startStamp = new Date().getTime();
    {
        camera.update();
        renderShadowMap();

        if (initLPV) {
            if (LPV.accumulatedBuffer && LPV.injectionFramebuffer) {
                LPV.clearInjectionBuffer();
                LPV.clearAccumulatedBuffer();
            }

            for (var i = 0; i < rsmFramebuffers.length; i++) {
                LPV.lightInjection(rsmFramebuffers[i]);
            }

            LPV.geometryInjection(rsmFramebuffers[0], directionalLight);
            LPV.lightPropagation(propagationIterations);
            initLPV = false;
        }

        if (LPV.accumulatedBuffer)
            renderScene(LPV.accumulatedBuffer);
    }


    var renderDelta = new Date().getTime() - startStamp;
    setTimeout(function () {
        requestAnimationFrame(render);
    }, 1000 / settings.target_fps - renderDelta - 1000 / 120);
}

function shadowMapNeedsRendering() {

    var lastDirection = shadowMapNeedsRendering.lastDirection || vec3.create();
    var lastMeshCount = shadowMapNeedsRendering.lastMeshCount || 0;
    var lastTexturesLoaded = shadowMapNeedsRendering.lastTexturesLoaded || 0;

    if (vec3.equals(lastDirection, directionalLight.direction) && lastMeshCount === meshes.length
        && lastTexturesLoaded == texturesLoaded) {

        return false;

    } else {
        shadowMapNeedsRendering.lastDirection = vec3.copy(lastDirection, directionalLight.direction);
        shadowMapNeedsRendering.lastMeshCount = meshes.length;
        shadowMapNeedsRendering.lastTexturesLoaded = texturesLoaded;

        return true;

    }
}
function renderShadowMap() {
    //TODO: only render when needed to
    if (!shadowMapNeedsRendering()) return;

    for (var i = 0; i < lightSources.length; i++) {
        var light = lightSources[i];

        var lightViewProjection = light.source.getLightViewProjectionMatrix();
        var lightDirection;
        if (light.type === 'DIRECTIONAL_LIGHT') {
            lightDirection = light.source.viewSpaceDirection(camera);
        } else if (light.type === 'SPOT_LIGHT') {
            lightDirection = light.source.direction;
        }

        var lightColor = light.source.color;

        app.drawFramebuffer(rsmFramebuffers[i])
            .viewport(0, 0, shadowMapSmallSize, shadowMapSmallSize)
            .depthTest()
            .depthFunc(PicoGL.LEQUAL)
            .noBlend()
            .clear();

        for (var j = 0, len = meshes.length; j < len; j++) {

            var mesh = meshes[j];

            mesh.rsmDrawCall
                .uniform('u_is_directional_light', light.type === 'DIRECTIONAL_LIGHT')
                .uniform('u_world_from_local', mesh.modelMatrix)
                .uniform('u_light_projection_from_world', lightViewProjection)
                .uniform('u_light_direction', lightDirection)
                .uniform('u_spot_light_cone', light.source.cone)
                .uniform('u_light_color', lightColor)
                .uniform('u_spot_light_position', light.source.position || vec3.fromValues(0, 0, 0))
                .draw();
        }
    }

    var lightViewProjection = directionalLight.getLightViewProjectionMatrix();

    app.drawFramebuffer(shadowMapFramebuffer)
        .viewport(0, 0, shadowMapSize, shadowMapSize)
        .depthTest()
        .depthFunc(PicoGL.LEQUAL)
        .noBlend()
        .clear();

    for (var i = 0, len = meshes.length; i < len; ++i) {
        var mesh = meshes[i];

        mesh.shadowMapDrawCall
            .uniform('u_world_from_local', mesh.modelMatrix)
            .uniform('u_light_projection_from_world', lightViewProjection)
            .draw();
    }

    initLPV = true;
}
function renderScene(framebuffer) {

    var dirLightViewDirection = directionalLight.viewSpaceDirection(camera);
    var lightViewProjection = directionalLight.getLightViewProjectionMatrix();
    var shadowMap = shadowMapFramebuffer.depthTexture;

    app.defaultDrawFramebuffer()
        .defaultViewport()
        .depthTest()
        .depthFunc(PicoGL.LEQUAL)
        .noBlend()
        .clear();

    for (var i = 0, len = meshes.length; i < len; ++i) {
        var mesh = meshes[i];


        mesh.drawCall
            .uniform('u_ambient_light_attenuation', settings.ambient_light)
            .uniform('u_world_from_local', mesh.modelMatrix)
            .uniform('u_view_from_world', camera.viewMatrix)
            .uniform('u_projection_from_view', camera.projectionMatrix)
            .uniform('u_dir_light_color', directionalLight.color)
            .uniform('u_dir_light_view_direction', dirLightViewDirection)
            .uniform('u_light_projection_from_world', lightViewProjection)
            .uniform('u_lpv_grid_size', LPV.framebufferSize)

            .uniform('u_indirect_light_attenuation', settings.indirect_light_attenuation)
            .texture('u_shadow_map', shadowMap)

            .texture('u_red_indirect_light', framebuffer.colorTextures[0])
            .texture('u_green_indirect_light', framebuffer.colorTextures[1])
            .texture('u_blue_indirect_light', framebuffer.colorTextures[2])
            .draw();
    }

}

