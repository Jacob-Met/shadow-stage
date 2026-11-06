# Motion notes: scale drift and continuous geometric framing

This is an analytical authoring note, not an executed fit, render or qualification. It combines independent source derivations from the unchanged physical fitter. The frozen [core source](https://github.com/Jacob-Met/shadow-stage/blob/e1b292ee64f78dac6343cc84b73db0ef7f13fbb5/src/core.js) has SHA-256 `ff7bb9f70fa52fd8348111d35928f3d01804344345af38b55f21e823c422c67b`. All existing frozen files remain unchanged.

The formulas specialize to fixed light height 5, matched light/cutout key times and the shared smoothstep interpolation used by `fitScene`. Let $u\in[0,1]$ be that smoothstep parameter, not raw elapsed time. Let $o$ and $l$ denote horizontal cutout and light positions, $z$ cutout depth, and $p$ a local cutout vertex. The [projection and interpolation](https://github.com/Jacob-Met/shadow-stage/blob/e1b292ee64f78dac6343cc84b73db0ef7f13fbb5/src/core.js#L48-L67) are

$$
q(u,p)=T(u)+m(u)R(\theta(u))p,\qquad
m(u)=\frac{5}{5-z(u)},\qquad
T(u)=l(u)+m(u)(o(u)-l(u)).
$$

Here $T$ is the projected local-origin translation. It is a silhouette center only when the chosen local origin represents that center. Scene validity and positive separation are prerequisites throughout this note.

## Equal endpoint origins can drift during a scale transition

The [fitter construction](https://github.com/Jacob-Met/shadow-stage/blob/e1b292ee64f78dac6343cc84b73db0ef7f13fbb5/src/core.js#L112-L123) splits a fitted translation between the light and cutout using $a=\text{lightShare}$. If both authored keys have the same fitted translation $f$, but physical magnifications $S_0,S_1$, its endpoints are

$$
o_i=\frac{(1-a)f}{S_i},\quad
l_i=-\frac{af}{S_i-1},\quad
z_i=5\left(1-\frac1{S_i}\right).
$$

Interpolating those physical quantities and then projecting does not generally keep the origin at $f$. Direct substitution yields

$$
T(u)-f=
\frac{af\,u(1-u)(S_1-S_0)^2}
{(S_0-1)(S_1-1)((1-u)S_1+uS_0)}.
$$

This formula is component-wise in $f$. For admissible fitted magnifications greater than 1, the scalar coefficient is nonnegative. A nonzero origin can move outward from the stage origin between equal endpoint origins. This is physical-parameter interpolation, not an SVG coordinate-mapping error.

### Exact, unexecuted example

Take fitted scales 1 and 2, fitted translation $f=(1/2,0)$, and $a=13/20$. The fitter chooses physical magnifications $S_0=7/5$ and $S_1=14/5$. For an initial unit square whose vertex-mean center is $f$, local physical square vertices are $(\pm5/14,\pm5/14)$. The endpoint parameters are:

| Quantity | First key | Second key |
|---|---:|---:|
| Cutout horizontal x | 1/8 | 1/16 |
| Light horizontal x | −13/16 | −13/72 |
| Cutout depth z | 10/7 | 45/14 |
| Light height | 5 | 5 |

At $u=1/2$,

$$
T=(523/864,0),\qquad T-f=(91/864,0).
$$

All y translations are zero and the physical square is centered at its local origin. The listed keys and polygon satisfy the relevant source validator bounds in exact arithmetic. These are exact algebraic values, not measured fitted or rendered coordinates. They demonstrate why matching endpoint translations does not establish a stationary intermediate origin.

**Concrete author choice:** `lightShare=0` eliminates this equal-origin drift for an otherwise admissible construction. The formula also vanishes when scales are equal or the fixed origin is zero. This does not make arbitrary physical motion match interpolated SVG targets, guarantee camera framing, or establish pixel behavior. Changing lightShare can also affect parameter admission, so retain the actual validation and fit report.

## A sufficient continuous framing check

The following bound covers an entire adjacent-key segment rather than a finite set of samples. Define

$$
D_i=5-z_i>0,\qquad m_i=5/D_i,\qquad
T_i=l_i+m_i(o_i-l_i),
$$

and $m_{\min}=\min(m_0,m_1)$, $m_{\max}=\max(m_0,m_1)$. For coordinate $j\in\{x,y\}$, define the signed expansion

$$
E_j=\frac{(z_1-z_0)(l_{1j}-l_{0j})}
{(\sqrt{D_0}+\sqrt{D_1})^2}.
$$

A valid envelope for the projected origin is

$$
L_j=\min(T_{0j},T_{1j})+\min(0,E_j),\qquad
U_j=\max(T_{0j},T_{1j})+\max(0,E_j).
$$

To see why, write $D(u)=(1-u)D_0+uD_1$. The exact projected origin satisfies

$$
T(u)=\frac{(1-u)D_0T_0+uD_1T_1}{D(u)}
+\frac{u(1-u)(D_0-D_1)(l_1-l_0)}{D(u)}.
$$

The first term is a convex combination of endpoint origins, while

$$
\max_{u\in[0,1]}\frac{u(1-u)}{D(u)}
=\frac1{(\sqrt{D_0}+\sqrt{D_1})^2}.
$$

Thus the signed correction is bounded by $E_j$; it vanishes if depth or the relevant light coordinate stays constant.

Let $\rho=\max_p\sqrt{p_x^2+p_y^2}$ over local polygon vertices. Rotation preserves this radius, so the entire projected polygon lies within

$$
[L_x-m_{\max}\rho,\ U_x+m_{\max}\rho]
\times
[L_y-m_{\max}\rho,\ U_y+m_{\max}\rho].
$$

The disk containing all vertices also contains all edges and the polygon interior, including for a simple concave polygon. With the [offline camera](https://github.com/Jacob-Met/shadow-stage/blob/e1b292ee64f78dac6343cc84b73db0ef7f13fbb5/tools/export_video.py) $(500+260x,350-260y)$, the geometric viewport is

$$
x\in[-25/13,25/13],\qquad y\in[-7/5,35/26].
$$

If the rectangle above fits inside this viewport with a chosen positive margin, that is a sufficient continuous **geometric** no-clipping condition for the segment. A nominal $p$-pixel margin corresponds to $p/260$ stage units, but that conversion is not a certified antialiasing/codec support bound. Apply the check to every segment. Failure is inconclusive: independent maxima may make the bound loose even for a well-framed motion.

### Optional refinement for slender cutouts

The radius bound can be too loose for a slender shape that rotates little. Instead use the actual shortest angle increment

$$
\Delta\theta=\operatorname{atan2}(\sin(\theta_1-\theta_0),\cos(\theta_1-\theta_0)).
$$

For each local vertex, bound $p_x\cos\theta-p_y\sin\theta$ and $p_x\sin\theta+p_y\cos\theta$ over that angle interval by checking endpoints and enclosed stationary angles. Take each coordinate's range $[a_j,b_j]$ across all vertices. Multiply by the positive magnification interval using all four products $m_{\min}a_j,m_{\min}b_j,m_{\max}a_j,m_{\max}b_j$; add the minimum/maximum to $[L_j,U_j]$. Do not multiply signed extrema blindly by $m_{\max}$.

This remains a conservative algebraic bound because scale, angle and origin share one interpolation parameter but the interval construction treats their extrema separately. It is not a proposed validator or new qualification course.

## What this does not establish

The core's [fit report](https://github.com/Jacob-Met/shadow-stage/blob/e1b292ee64f78dac6343cc84b73db0ef7f13fbb5/src/core.js#L92-L110) uses finite boundary and temporal samples; low sampled error alone does not certify every instant. Conversely, the continuous geometry bound above does not establish encoded-pixel identity, raster edge behavior, browser playback, artistic quality, fabrication or collision clearance. The equal-origin counterexample and framing proof were derived from source only; no importer, fitter or renderer was executed.
