#version 300 es
precision highp float;

#define PI 3.1415926f

#include <lpv_common.glsl>

uniform highp int u_grid_size;

uniform sampler2D u_red_contribution;
uniform sampler2D u_green_contribution;
uniform sampler2D u_blue_contribution;

flat in ivec2 v_cell_index;

layout(location = 0) out vec4 o_red_color;
layout(location = 1) out vec4 o_green_color;
layout(location = 2) out vec4 o_blue_color;

vec4 red_contribution = vec4(0.0);
vec4 green_contribution = vec4(0.0);
vec4 blue_contribution = vec4(0.0);

// orientation = [ right | up | forward ] = [ x | y | z ]
const mat3 neighbourOrientations[6] = mat3[] (
    // Z+
    mat3(1, 0, 0,0, 1, 0,0, 0, 1),
    // Z-
    mat3(-1, 0, 0,0, 1, 0,0, 0, -1),
    // X+
    mat3(0, 0, 1,0, 1, 0,-1, 0, 0
        ),
    // X-
    mat3(0, 0, -1,0, 1, 0,1, 0, 0),
    // Y+
    mat3(1, 0, 0,0, 0, 1,0, -1, 0),
    // Y-
    mat3(1, 0, 0,0, 0, -1,0, 1, 0)
);

// Faces in cube
const ivec2 sideFaces[4] = ivec2[] (
    ivec2(1, 0),   // right
    ivec2(0, 1),   // up
    ivec2(-1, 0),  // left
    ivec2(0, -1)   // down
);

vec3 getEvalSideDirection(int index, mat3 orientation)
{
    const float smallComponent = 0.4472135; // 1 / sqrt(5)
    const float bigComponent = 0.894427; // 2 / sqrt(5)

    vec2 current_side = vec2(sideFaces[index]);
    return orientation * vec3(current_side.x * smallComponent, current_side.y * smallComponent, bigComponent);
}

vec3 getReprojSideDirection(int index, mat3 orientation)
{
    ivec2 current_side = sideFaces[index];
    return orientation * vec3(current_side.x, current_side.y, 0);
}

void propagate()
{
    // Use solid angles to avoid inaccurate integral value stemming from low-order SH approximations
    const float directFaceSubtendedSolidAngle = 0.4006696846f / PI;
	const float sideFaceSubtendedSolidAngle = 0.4234413544f / PI;

    // Add contributions of neighbours to this cell
    for (int neighbour = 0; neighbour < 6; neighbour++)
    {
        mat3 orientation = neighbourOrientations[neighbour];
        vec3 direction = orientation * vec3(0.0, 0.0, 1.0);

        // Index offset in our flattened version of the lpv grid
        ivec2 index_offset = ivec2(
            direction.x + (direction.z * float(u_grid_size)), 
            direction.y
        );

        ivec2 neighbour_index = v_cell_index - index_offset;

        vec4 red_contribution_neighbour = texelFetch(u_red_contribution, neighbour_index, 0);
        vec4 green_contribution_neighbour = texelFetch(u_green_contribution, neighbour_index, 0);
        vec4 blue_contribution_neighbour = texelFetch(u_blue_contribution, neighbour_index, 0);

        vec4 direction_cosine_lobe = evalCosineLobeToDir(direction);
        vec4 direction_spherical_harmonic = dirToSH(direction);

        red_contribution += directFaceSubtendedSolidAngle * max(0.0, dot( red_contribution_neighbour, direction_spherical_harmonic)) * direction_cosine_lobe;
        green_contribution += directFaceSubtendedSolidAngle * max(0.0, dot( green_contribution_neighbour, direction_spherical_harmonic)) * direction_cosine_lobe;
        blue_contribution += directFaceSubtendedSolidAngle * max(0.0, dot( blue_contribution_neighbour, direction_spherical_harmonic)) * direction_cosine_lobe;

        // Add contributions of faces of neighbour
        for (int face = 0; face < 4; face++)
        {
            vec3 eval_direction = getEvalSideDirection(face, orientation);
            vec3 reproj_direction = getReprojSideDirection(face, orientation);

            vec4 reproj_direction_cosine_lobe = evalCosineLobeToDir( reproj_direction );
			vec4 eval_direction_spherical_harmonic = dirToSH( eval_direction );
			
		    red_contribution += sideFaceSubtendedSolidAngle * max(0.0, dot( red_contribution_neighbour, eval_direction_spherical_harmonic )) * reproj_direction_cosine_lobe;
			green_contribution += sideFaceSubtendedSolidAngle * max(0.0, dot( green_contribution_neighbour, eval_direction_spherical_harmonic )) * reproj_direction_cosine_lobe;
			blue_contribution += sideFaceSubtendedSolidAngle * max(0.0, dot( blue_contribution_neighbour, eval_direction_spherical_harmonic )) * reproj_direction_cosine_lobe;
        }
    }
}

void main()
{
    propagate();

    o_red_color += red_contribution;
    o_green_color += green_contribution;
    o_blue_color += blue_contribution;
}