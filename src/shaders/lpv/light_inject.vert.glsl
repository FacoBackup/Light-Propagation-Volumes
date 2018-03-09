#version 300 es

#include <common.glsl>

layout(location = 0) in vec2 a_point_position;

uniform int u_texture_slice;
uniform int u_rsm_size;

uniform sampler2D u_rsm_flux;
uniform sampler2D u_rsm_world_positions;
uniform sampler2D u_rsm_world_normals;

uniform mat4 u_world_from_local;
uniform mat4 u_view_from_world;
uniform mat4 u_projection_from_view;

#define v_min vec3(0.0)
#define CELLSIZE 4.0
#define GRIDSIZE 32.0

struct RSMTexel 
{
	vec3 world_position;
	vec3 world_normal;
	vec4 flux;
};

out RSMTexel v_rsm_texel;
flat out ivec3 v_grid_cell;

ivec3 getGridCell(vec3 pos, vec3 normal) 
{
	//displace by half a normal
	return ivec3((pos / CELLSIZE) + 0.5 * normal);
}

RSMTexel getRSMTexel(ivec2 texCoord) 
{
	RSMTexel texel;
	texel.world_normal = texelFetch(u_rsm_world_normals, texCoord, 0).xyz;
	texel.world_position = texelFetch(u_rsm_world_positions, texCoord, 0).xyz;
	texel.flux = texelFetch(u_rsm_flux, texCoord, 0);
	return texel;
}

//TODO:figure out of to get the correct texture layer and render to the 3d texture correctly
void main()
{
	ivec2 rsmTexCoords = ivec2(gl_VertexID % u_rsm_size, gl_VertexID / u_rsm_size);

	v_rsm_texel = getRSMTexel(rsmTexCoords);
	v_grid_cell = getGridCell(v_rsm_texel.world_position,v_rsm_texel.world_normal);

	mat4 transformations = u_projection_from_view * u_view_from_world * u_world_from_local;
	vec4 worldGridPos = transformations * vec4(v_grid_cell, 1.0);

	gl_PointSize = 4.0;
	gl_Position = vec4(v_grid_cell, 1.0);
}
