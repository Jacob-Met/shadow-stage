extends Node3D
# Shadow Stage: a lamp, a paper screen and black card shapes on sticks.
# Each act draws a chalk outline on the screen; move the cards until their
# real shadows fill it. The last act asks Nemotron to compose a new figure.

const LAMP := Vector3(0.0, 1.0, 3.2)          # flame position; the screen is the plane z = 0
const SCREEN_MIN := Vector2(-1.6, 0.15)
const SCREEN_MAX := Vector2(1.6, 2.15)
const Z_MIN := 0.35
const Z_MAX := 2.45
const GRID := Vector2i(128, 80)               # match raster
const TEX := Vector2i(640, 400)               # chalk outline texture
const CARD := 0.006

const INK := Color(0.035, 0.03, 0.028)
const PAPER := Color(0.93, 0.86, 0.72)
const FLAME := Color(1.0, 0.74, 0.42)
const CHALK_COLD := Color(0.86, 0.9, 1.0)
const CHALK_WARM := Color(1.0, 0.78, 0.38)

const ROMAN := ["I", "II", "III", "IV", "V", "VI"]

class Piece:
	var key: String
	var poly: PackedVector2Array
	var sym: float
	var pos: Vector3
	var rot: float
	var node: Node3D
	var card: CSGPolygon3D
	var stick: MeshInstance3D
	var mat: StandardMaterial3D
	var locked := false

var acts: Array = []
var act := 0
var pieces: Array = []
var solution: Array = []          # [{key, pos, rot}]
var target_mask := PackedByteArray()
var target_area := 0
var match_score := 0.0
var solved := false
var hold := 0.0

var cam: Camera3D
var lamp_light: OmniLight3D
var flame: MeshInstance3D
var overlay_mat: StandardMaterial3D
var overlay: MeshInstance3D

var hovered: Piece = null
var dragging: Piece = null
var drag_offset := Vector2.ZERO
var rotating := false
var used := {"drag": false, "scroll": false, "turn": false}

var ui: CanvasLayer
var act_label: Label
var hint_label: Label
var meter_bg: ColorRect
var meter_fill: ColorRect
var card_root: Control
var card_title: Label
var card_sub: Label
var ask_box: LineEdit
var http: HTTPRequest
var thinking := false
var ask_msgs := []
var ask_round := 0
var ask_word := ""
var ask_first: Array = []
var ask_title := ""
var ask_headers: Array = []

var bell: AudioStreamPlayer
var bell_queue := PackedVector2Array()
var t := 0.0
var shots_dir := ""
var ask_test := ""


func _ready() -> void:
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--shots="):
			shots_dir = a.substr(8)
		elif a.begins_with("--ask="):
			ask_test = a.substr(6)
	_build_world()
	_build_ui()
	_build_audio()
	acts = _make_acts()
	_start_act(0)
	if shots_dir != "" and ask_test != "":
		_run_ask_test()
	elif shots_dir != "":
		_run_shots()


# ---------------------------------------------------------------- world

func _noise_tex(freq: float, a: Color, b: Color, stretch := Vector2.ONE, seed := 1) -> NoiseTexture2D:
	var n := FastNoiseLite.new()
	n.seed = seed
	n.frequency = freq
	n.fractal_octaves = 5
	var g := Gradient.new()
	g.set_color(0, a)
	g.set_color(1, b)
	var tex := NoiseTexture2D.new()
	tex.width = int(512 * stretch.x)
	tex.height = int(512 * stretch.y)
	tex.seamless = true
	tex.noise = n
	tex.color_ramp = g
	return tex


func _box(size: Vector3, pos: Vector3, mat: Material, shadows := true) -> MeshInstance3D:
	var m := MeshInstance3D.new()
	var b := BoxMesh.new()
	b.size = size
	m.mesh = b
	m.position = pos
	m.material_override = mat
	if not shadows:
		m.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(m)
	return m


func _build_world() -> void:
	var env := Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color(0.012, 0.01, 0.012)
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.35, 0.38, 0.5)
	env.ambient_light_energy = 0.02
	env.tonemap_mode = Environment.TONE_MAPPER_AGX
	env.tonemap_exposure = 1.05
	env.glow_enabled = true
	env.glow_intensity = 0.7
	env.glow_bloom = 0.04
	env.glow_hdr_threshold = 1.2
	env.ssao_enabled = true
	env.ssao_radius = 0.6
	env.ssao_intensity = 1.6
	env.volumetric_fog_enabled = true
	env.volumetric_fog_density = 0.008
	env.volumetric_fog_albedo = Color(0.9, 0.85, 0.8)
	env.volumetric_fog_anisotropy = 0.55
	env.volumetric_fog_length = 9.0
	var we := WorldEnvironment.new()
	we.environment = env
	add_child(we)

	cam = Camera3D.new()
	cam.fov = 40.0
	cam.position = Vector3(2.35, 1.85, 5.6)
	add_child(cam)
	cam.look_at(Vector3(-0.05, 1.0, 0.7))

	# table
	var wood := StandardMaterial3D.new()
	wood.albedo_texture = _noise_tex(0.012, Color(0.09, 0.05, 0.03), Color(0.24, 0.14, 0.08), Vector2(0.5, 2.0), 7)
	wood.roughness = 0.62
	wood.uv1_scale = Vector3(2, 1, 1)
	_box(Vector3(5.2, 0.08, 4.6), Vector3(0, -0.04, 1.55), wood)
	# far walls, barely there
	var wall := StandardMaterial3D.new()
	wall.albedo_color = Color(0.06, 0.05, 0.05)
	wall.roughness = 1.0
	_box(Vector3(9, 6, 0.1), Vector3(0, 2, -1.2), wall, false)
	_box(Vector3(0.1, 6, 9), Vector3(-3.6, 2, 1.5), wall, false)

	# paper screen in a wooden frame
	var paper := StandardMaterial3D.new()
	paper.albedo_texture = _noise_tex(0.06, PAPER.darkened(0.06), PAPER, Vector2.ONE, 3)
	paper.roughness = 0.95
	var screen := MeshInstance3D.new()
	var q := QuadMesh.new()
	q.size = SCREEN_MAX - SCREEN_MIN
	screen.mesh = q
	screen.position = Vector3((SCREEN_MIN.x + SCREEN_MAX.x) / 2, (SCREEN_MIN.y + SCREEN_MAX.y) / 2, 0)
	screen.material_override = paper
	add_child(screen)
	var frame := StandardMaterial3D.new()
	frame.albedo_texture = wood.albedo_texture
	frame.roughness = 0.5
	var fw := 0.07
	var c := screen.position
	_box(Vector3(3.2 + fw * 2, fw, 0.06), Vector3(c.x, SCREEN_MAX.y + fw / 2, -0.02), frame)
	_box(Vector3(3.2 + fw * 2, fw, 0.06), Vector3(c.x, SCREEN_MIN.y - fw / 2, -0.02), frame)
	_box(Vector3(fw, 2.0 + fw * 2, 0.06), Vector3(SCREEN_MIN.x - fw / 2, c.y, -0.02), frame)
	_box(Vector3(fw, 2.0 + fw * 2, 0.06), Vector3(SCREEN_MAX.x + fw / 2, c.y, -0.02), frame)
	_box(Vector3(0.5, 0.05, 0.3), Vector3(-1.4, 0.025, 0.05), frame)
	_box(Vector3(0.5, 0.05, 0.3), Vector3(1.4, 0.025, 0.05), frame)

	# chalk outline lives on a quad just in front of the paper
	overlay = MeshInstance3D.new()
	var oq := QuadMesh.new()
	oq.size = SCREEN_MAX - SCREEN_MIN
	overlay.mesh = oq
	overlay.position = screen.position + Vector3(0, 0, 0.004)
	overlay.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	overlay_mat = StandardMaterial3D.new()
	overlay_mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	overlay_mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	overlay_mat.albedo_color = CHALK_COLD
	overlay.material_override = overlay_mat
	add_child(overlay)

	# the lamp
	var brass := StandardMaterial3D.new()
	brass.albedo_color = Color(0.62, 0.43, 0.2)
	brass.metallic = 1.0
	brass.roughness = 0.32
	var rod := MeshInstance3D.new()
	var cyl := CylinderMesh.new()
	cyl.top_radius = 0.012
	cyl.bottom_radius = 0.014
	cyl.height = LAMP.y - 0.08
	rod.mesh = cyl
	rod.position = Vector3(LAMP.x, (LAMP.y - 0.08) / 2, LAMP.z + 0.02)
	rod.material_override = brass
	rod.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(rod)
	var foot := MeshInstance3D.new()
	var fc := CylinderMesh.new()
	fc.top_radius = 0.09
	fc.bottom_radius = 0.12
	fc.height = 0.03
	foot.mesh = fc
	foot.position = Vector3(LAMP.x, 0.015, LAMP.z + 0.02)
	foot.material_override = brass
	add_child(foot)
	var cup := MeshInstance3D.new()
	var cupm := SphereMesh.new()
	cupm.radius = 0.08
	cupm.height = 0.09
	cup.mesh = cupm
	cup.position = Vector3(LAMP.x, LAMP.y - 0.06, LAMP.z + 0.02)
	cup.material_override = brass
	cup.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(cup)
	flame = MeshInstance3D.new()
	var fm := SphereMesh.new()
	fm.radius = 0.022
	fm.height = 0.07
	flame.mesh = fm
	flame.position = LAMP
	var fmat := StandardMaterial3D.new()
	fmat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	fmat.albedo_color = Color(1.0, 0.85, 0.55)
	fmat.emission_enabled = true
	fmat.emission = FLAME
	fmat.emission_energy_multiplier = 9.0
	flame.material_override = fmat
	flame.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(flame)

	lamp_light = OmniLight3D.new()
	lamp_light.position = LAMP
	lamp_light.light_color = FLAME
	lamp_light.light_energy = 2.6
	lamp_light.omni_range = 9.0
	lamp_light.omni_attenuation = 0.9
	lamp_light.shadow_enabled = true
	lamp_light.light_size = 0.012
	lamp_light.shadow_bias = 0.02
	lamp_light.light_volumetric_fog_energy = 1.4
	add_child(lamp_light)

	# faint cold window light so the backstage reads; it casts nothing
	var moon := DirectionalLight3D.new()
	moon.light_color = Color(0.55, 0.62, 0.85)
	moon.light_energy = 0.02
	moon.shadow_enabled = false
	moon.light_volumetric_fog_energy = 0.0
	moon.rotation_degrees = Vector3(-55, 35, 0)
	add_child(moon)


# ---------------------------------------------------------------- shapes

func _disc(r: float, rx := -1.0) -> PackedVector2Array:
	var ry := r
	if rx < 0.0:
		rx = r
	var p := PackedVector2Array()
	for i in 40:
		var a := TAU * i / 40.0
		p.append(Vector2(cos(a) * rx, sin(a) * ry))
	return p


func _shape(kind: String, a: float, b := 0.0) -> Dictionary:
	match kind:
		"disc":
			return {"key": "disc:%.3f" % a, "poly": _disc(a), "sym": 0.0}
		"ellipse":
			return {"key": "ellipse:%.3f:%.3f" % [a, b], "poly": _disc(b, a), "sym": PI}
		"rect":
			var w := a / 2.0
			var h := b / 2.0
			var sym := PI / 2.0 if is_equal_approx(a, b) else PI
			return {"key": "rect:%.3f:%.3f" % [a, b], "poly": PackedVector2Array([Vector2(-w, -h), Vector2(w, -h), Vector2(w, h), Vector2(-w, h)]), "sym": sym}
		"tri":
			if b > 0.0:
				return {"key": "tri:%.3f:%.3f" % [a, b], "poly": PackedVector2Array([Vector2(-a / 2, -b / 3), Vector2(a / 2, -b / 3), Vector2(0, b * 2 / 3)]), "sym": TAU}
			var r := a / sqrt(3.0)
			var p := PackedVector2Array()
			for i in 3:
				var ang := PI / 2.0 + TAU * i / 3.0
				p.append(Vector2(cos(ang), sin(ang)) * r)
			return {"key": "tri:%.3f" % a, "poly": p, "sym": TAU / 3.0}
		"wing":
			return {"key": "wing:%.3f" % a, "poly": PackedVector2Array([Vector2(-a, 0), Vector2(a, 0), Vector2(a * 0.25, a * 1.1)]), "sym": TAU}
	return {}


# A piece is described where its *shadow* should be: centre s (on the screen),
# rotation, and depth z. Physical position follows from the lamp.
func _from_shadow(s: Vector2, z: float) -> Vector3:
	var k := LAMP.z / (LAMP.z - z)
	return Vector3(LAMP.x + (s.x - LAMP.x) / k, LAMP.y + (s.y - LAMP.y) / k, z)


func _spec(kind: String, a: float, b: float, s: Vector2, z: float, rot_deg: float) -> Dictionary:
	var d := _shape(kind, a, b)
	d["pos"] = _from_shadow(s, z)
	d["rot"] = deg_to_rad(rot_deg)
	return d


func _make_acts() -> Array:
	return [
		{"name": "The Moon", "hint": "Drag the card. Its shadow follows.",
			"sol": [_spec("disc", 0.12, 0, Vector2(-0.75, 1.62), 1.6, 0)],
			"start": [[Vector2(0.75, 0.75), 1.6, 0.0]]},
		{"name": "Sunrise over the Hill", "hint": "Scroll over a card to bring it nearer the lamp. Its shadow grows.",
			"sol": [_spec("disc", 0.1, 0, Vector2(0.45, 1.3), 2.2, 0), _spec("ellipse", 0.36, 0.16, Vector2(-0.1, 0.45), 1.6, 0)],
			"start": [[Vector2(1.0, 0.9), 1.3, 0.0], [Vector2(-0.9, 1.5), 1.6, 0.0]]},
		{"name": "A House", "hint": "Right-drag a card (or press Q / E) to turn it.",
			"sol": [_spec("rect", 0.25, 0.25, Vector2(-0.2, 0.68), 1.6, 0), _spec("tri", 0.34, 0, Vector2(-0.2, 1.1), 1.6, 0),
				_spec("rect", 0.05, 0.14, Vector2(0.06, 1.2), 1.6, 0)],
			"start": [[Vector2(0.7, 0.6), 1.6, 20.0], [Vector2(1.05, 1.3), 1.6, 60.0], [Vector2(0.5, 1.6), 1.6, 70.0]]},
		{"name": "The Hare", "hint": "",
			"sol": [_spec("ellipse", 0.17, 0.12, Vector2(0.15, 0.72), 1.6, 0), _spec("disc", 0.075, 0, Vector2(0.47, 0.95), 1.6, 0),
				_spec("ellipse", 0.028, 0.15, Vector2(0.38, 1.3), 1.6, 24), _spec("ellipse", 0.028, 0.14, Vector2(0.6, 1.27), 1.6, -20),
				_spec("disc", 0.04, 0, Vector2(-0.19, 0.78), 1.6, 0)],
			"start": [[Vector2(-1.0, 0.6), 1.4, 30.0], [Vector2(-0.9, 1.5), 1.8, 0.0], [Vector2(1.1, 0.5), 1.6, 70.0],
				[Vector2(1.25, 1.1), 1.5, -60.0], [Vector2(-0.5, 1.75), 1.6, 0.0]]},
		{"name": "The Cat", "hint": "",
			"sol": [_spec("ellipse", 0.2, 0.11, Vector2(-0.05, 0.62), 1.6, 0), _spec("disc", 0.085, 0, Vector2(0.33, 0.92), 1.6, 0),
				_spec("tri", 0.1, 0, Vector2(0.25, 1.1), 1.6, 12), _spec("tri", 0.1, 0, Vector2(0.42, 1.1), 1.6, -12),
				_spec("ellipse", 0.022, 0.2, Vector2(-0.5, 0.86), 1.6, 28)],
			"start": [[Vector2(-1.0, 1.55), 1.4, 20.0], [Vector2(1.1, 0.55), 1.8, 0.0], [Vector2(1.15, 1.5), 1.6, 50.0],
				[Vector2(0.75, 1.75), 1.6, -45.0], [Vector2(-1.1, 0.5), 1.6, -50.0]]},
		{"name": "Ask the Lamp", "hint": "Type what you want to see, then press Enter.", "sol": [], "start": [], "ask": true},
	]


# ---------------------------------------------------------------- acts

func _clear_pieces() -> void:
	for p in pieces:
		p.node.queue_free()
	pieces.clear()


func _make_piece(d: Dictionary, pos: Vector3, rot: float) -> Piece:
	var p := Piece.new()
	p.key = d["key"]
	p.poly = d["poly"]
	p.sym = d["sym"]
	p.pos = pos
	p.rot = rot
	p.node = Node3D.new()
	add_child(p.node)
	p.mat = StandardMaterial3D.new()
	p.mat.albedo_color = INK
	p.mat.roughness = 0.8
	p.mat.emission_enabled = true
	p.mat.emission = Color(0, 0, 0)
	p.card = CSGPolygon3D.new()
	p.card.polygon = p.poly
	p.card.depth = CARD
	p.card.material = p.mat
	p.node.add_child(p.card)
	p.stick = MeshInstance3D.new()
	var sm := CylinderMesh.new()
	sm.top_radius = 0.006
	sm.bottom_radius = 0.006
	sm.height = 1.0
	p.stick.mesh = sm
	var smat := StandardMaterial3D.new()
	smat.albedo_color = Color(0.32, 0.22, 0.13)
	smat.roughness = 0.7
	p.stick.material_override = smat
	p.stick.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	p.node.add_child(p.stick)
	_place(p)
	return p


func _place(p: Piece) -> void:
	p.card.position = Vector3(p.pos.x, p.pos.y, p.pos.z + CARD / 2)
	p.card.rotation = Vector3(0, 0, p.rot)
	var h: float = max(p.pos.y, 0.05)
	p.stick.position = Vector3(p.pos.x, h / 2, p.pos.z - 0.012)
	p.stick.scale = Vector3(1, h, 1)


func _start_act(i: int) -> void:
	act = i
	solved = false
	hold = 0.0
	_clear_pieces()
	var a: Dictionary = acts[i]
	solution = a["sol"]
	for j in solution.size():
		var st: Array = a["start"][j]
		var pos := _from_shadow(st[0], st[1])
		pieces.append(_make_piece(solution[j], pos, deg_to_rad(st[2])))
	_bake_target()
	act_label.text = "ACT %s  ·  %s" % [ROMAN[i], String(a["name"]).to_upper()]
	_set_hint(a["hint"])
	ask_box.visible = a.has("ask")
	if a.has("ask") and shots_dir == "":
		ask_box.grab_focus()
	_intertitle("Act %s" % ROMAN[i], a["name"])
	_update_match()


func _set_hint(s: String) -> void:
	hint_label.text = s
	var tw := create_tween()
	hint_label.modulate.a = 0.0
	tw.tween_property(hint_label, "modulate:a", 1.0 if s != "" else 0.0, 0.8)


# ---------------------------------------------------------------- projection + matching

func _project(poly: PackedVector2Array, pos: Vector3, rot: float) -> PackedVector2Array:
	var k := LAMP.z / (LAMP.z - pos.z)
	var out := PackedVector2Array()
	var c := cos(rot)
	var s := sin(rot)
	for v in poly:
		var w := Vector2(v.x * c - v.y * s + pos.x, v.x * s + v.y * c + pos.y)
		out.append(Vector2(LAMP.x + (w.x - LAMP.x) * k, LAMP.y + (w.y - LAMP.y) * k))
	return out


func _raster(polys: Array, size: Vector2i) -> PackedByteArray:
	var m := PackedByteArray()
	m.resize(size.x * size.y)
	var span := SCREEN_MAX - SCREEN_MIN
	for poly in polys:
		var lo := Vector2(INF, INF)
		var hi := Vector2(-INF, -INF)
		for v in poly:
			lo = lo.min(v)
			hi = hi.max(v)
		var x0 := clampi(int((lo.x - SCREEN_MIN.x) / span.x * size.x), 0, size.x - 1)
		var x1 := clampi(int((hi.x - SCREEN_MIN.x) / span.x * size.x) + 1, 0, size.x - 1)
		var y0 := clampi(int((lo.y - SCREEN_MIN.y) / span.y * size.y), 0, size.y - 1)
		var y1 := clampi(int((hi.y - SCREEN_MIN.y) / span.y * size.y) + 1, 0, size.y - 1)
		for y in range(y0, y1 + 1):
			var py := SCREEN_MIN.y + (y + 0.5) / size.y * span.y
			for x in range(x0, x1 + 1):
				var idx := y * size.x + x
				if m[idx] == 1:
					continue
				var px := SCREEN_MIN.x + (x + 0.5) / size.x * span.x
				if Geometry2D.is_point_in_polygon(Vector2(px, py), poly):
					m[idx] = 1
	return m


func _bake_target() -> void:
	var polys := []
	for d in solution:
		polys.append(_project(d["poly"], d["pos"], d["rot"]))
	target_mask = _raster(polys, GRID)
	target_area = 0
	for b in target_mask:
		target_area += b
	var hi := _raster(polys, TEX)
	var img := Image.create(TEX.x, TEX.y, false, Image.FORMAT_RGBA8)
	var rng := RandomNumberGenerator.new()
	rng.seed = 17
	for y in TEX.y:
		for x in TEX.x:
			var inside := hi[y * TEX.x + x] == 1
			var edge := false
			if inside:
				for o in [Vector2i(2, 0), Vector2i(-2, 0), Vector2i(0, 2), Vector2i(0, -2)]:
					var nx: int = x + o.x
					var ny: int = y + o.y
					if nx < 0 or ny < 0 or nx >= TEX.x or ny >= TEX.y or hi[ny * TEX.x + nx] == 0:
						edge = true
						break
			var a := 0.0
			if edge:
				a = 0.55 + 0.45 * rng.randf()
				if rng.randf() < 0.12:
					a *= 0.3
			elif inside:
				a = 0.025
			# image rows run top-down; the screen's y runs up
			img.set_pixel(x, TEX.y - 1 - y, Color(1, 1, 1, a))
	overlay_mat.albedo_texture = ImageTexture.create_from_image(img)


func _update_match() -> void:
	if solution.is_empty():
		match_score = 0.0
		_paint_meter()
		return
	var polys := []
	for p in pieces:
		polys.append(_project(p.poly, p.pos, p.rot))
	var cur := _raster(polys, GRID)
	var inter := 0
	var uni := 0
	for i in cur.size():
		var a := target_mask[i]
		var b := cur[i]
		inter += a & b
		uni += a | b
	match_score = float(inter) / max(uni, 1)
	_paint_meter()


func _paint_meter() -> void:
	meter_fill.size.x = meter_bg.size.x * match_score
	var warm := CHALK_COLD.lerp(CHALK_WARM, smoothstep(0.3, 0.95, match_score))
	overlay_mat.albedo_color = Color(warm, 0.0 if solved else 0.6 + 0.4 * match_score)
	meter_fill.color = warm


func _angle_gap(a: float, b: float, sym: float) -> float:
	if sym <= 0.0:
		return 0.0
	var d := fposmod(a - b, sym)
	return min(d, sym - d)


# Close enough to a free spot of the same card? Click it in.
func _try_snap(p: Piece) -> void:
	var taken := []
	for o in pieces:
		if o != p and o.locked:
			taken.append(_nearest_slot(o, []))
	var j := _nearest_slot(p, taken)
	if j < 0:
		return
	var d: Dictionary = solution[j]
	var sp: Vector3 = d["pos"]
	var cs := _shadow_centre(p.pos)
	var ct := _shadow_centre(sp)
	var k_now := LAMP.z / (LAMP.z - p.pos.z)
	var k_sol := LAMP.z / (LAMP.z - sp.z)
	if cs.distance_to(ct) < 0.09 and abs(k_now / k_sol - 1.0) < 0.12 and _angle_gap(p.rot, d["rot"], p.sym) < deg_to_rad(14):
		var goal_rot: float = d["rot"]
		if p.sym > 0.0:
			goal_rot = p.rot - (fposmod(p.rot - goal_rot + p.sym / 2, p.sym) - p.sym / 2)
		p.locked = true
		var tw := create_tween().set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
		tw.tween_method(func(v: float):
			p.pos = p.pos.lerp(sp, v)
			p.rot = lerp_angle(p.rot, goal_rot, v)
			_place(p)
			_update_match(), 0.0, 1.0, 0.22)
		_tick()


func _shadow_centre(pos: Vector3) -> Vector2:
	var k := LAMP.z / (LAMP.z - pos.z)
	return Vector2(LAMP.x + (pos.x - LAMP.x) * k, LAMP.y + (pos.y - LAMP.y) * k)


func _nearest_slot(p: Piece, taken: Array) -> int:
	var best := -1
	var bd := INF
	for j in solution.size():
		if j in taken or solution[j]["key"] != p.key:
			continue
		var dd := _shadow_centre(p.pos).distance_to(_shadow_centre(solution[j]["pos"]))
		if dd < bd:
			bd = dd
			best = j
	return best


# ---------------------------------------------------------------- input

func _ray() -> Array:
	var mp := get_viewport().get_mouse_position()
	return [cam.project_ray_origin(mp), cam.project_ray_normal(mp)]


func _hit_plane(z: float) -> Variant:
	var r := _ray()
	return Plane(Vector3(0, 0, 1), z).intersects_ray(r[0], r[1])


func _pick() -> Piece:
	var best: Piece = null
	var bd := INF
	var r := _ray()
	for p in pieces:
		var h = Plane(Vector3(0, 0, 1), p.pos.z).intersects_ray(r[0], r[1])
		if h == null:
			continue
		var local := (Vector2(h.x, h.y) - Vector2(p.pos.x, p.pos.y)).rotated(-p.rot)
		var hit := Geometry2D.is_point_in_polygon(local, p.poly)
		if not hit:
			# fat-finger margin for thin cards
			for v in p.poly:
				if local.distance_to(v) < 0.025:
					hit = true
					break
		if hit:
			var dist: float = (h - r[0]).length()
			if dist < bd:
				bd = dist
				best = p
	return best


func _unhandled_input(e: InputEvent) -> void:
	if solved or thinking:
		return
	if e is InputEventMouseButton:
		var mb := e as InputEventMouseButton
		if mb.button_index == MOUSE_BUTTON_LEFT:
			if mb.pressed:
				dragging = _pick()
				if dragging:
					dragging.locked = false
					var h = _hit_plane(dragging.pos.z)
					if h != null:
						drag_offset = Vector2(dragging.pos.x, dragging.pos.y) - Vector2(h.x, h.y)
			elif dragging:
				_try_snap(dragging)
				dragging = null
		elif mb.button_index == MOUSE_BUTTON_RIGHT:
			rotating = mb.pressed
			if mb.pressed:
				dragging = _pick()
				if dragging:
					dragging.locked = false
			elif dragging:
				_try_snap(dragging)
				dragging = null
		elif mb.pressed and (mb.button_index == MOUSE_BUTTON_WHEEL_UP or mb.button_index == MOUSE_BUTTON_WHEEL_DOWN):
			var p := hovered if hovered else _pick()
			if p:
				p.locked = false
				var dz := 0.05 if mb.button_index == MOUSE_BUTTON_WHEEL_UP else -0.05
				p.pos.z = clampf(p.pos.z + dz, Z_MIN, Z_MAX)
				_place(p)
				_update_match()
				_used("scroll")
				_debounce_snap(p)
	elif e is InputEventMouseMotion:
		if dragging and rotating:
			dragging.rot -= (e as InputEventMouseMotion).relative.x * 0.01
			_place(dragging)
			_update_match()
			_used("turn")
		elif dragging:
			var h = _hit_plane(dragging.pos.z)
			if h != null:
				var xy := Vector2(h.x, h.y) + drag_offset
				dragging.pos.x = clampf(xy.x, -1.4, 1.4)
				dragging.pos.y = clampf(xy.y, 0.12, 2.0)
				_place(dragging)
				_update_match()
				_used("drag")
	elif e is InputEventKey and e.pressed and not ask_box.has_focus():
		var k := e as InputEventKey
		var p := hovered
		if p and (k.keycode == KEY_Q or k.keycode == KEY_E):
			p.locked = false
			p.rot += 0.12 if k.keycode == KEY_Q else -0.12
			_place(p)
			_update_match()
			_used("turn")
			_debounce_snap(p)
		elif k.keycode == KEY_R:
			_start_act(act)
		elif k.keycode == KEY_N:
			_start_act((act + 1) % acts.size())


var _snap_timer: SceneTreeTimer
func _debounce_snap(p: Piece) -> void:
	_snap_timer = get_tree().create_timer(0.35)
	var mine := _snap_timer
	mine.timeout.connect(func():
		if mine == _snap_timer and dragging == null:
			_try_snap(p))


func _used(what: String) -> void:
	if used[what]:
		return
	used[what] = true
	var h: String = acts[act]["hint"]
	if (what == "drag" and h.begins_with("Drag")) or (what == "scroll" and h.begins_with("Scroll")) or (what == "turn" and h.begins_with("Right")):
		var tw := create_tween()
		tw.tween_interval(1.2)
		tw.tween_property(hint_label, "modulate:a", 0.0, 1.0)


# ---------------------------------------------------------------- frame

func _process(dt: float) -> void:
	t += dt
	# flame breathes; it gutters while the model is thinking
	var f := 0.06 * sin(t * 7.3) + 0.04 * sin(t * 13.1 + 1.7) + 0.03 * sin(t * 23.0)
	if thinking:
		f = 0.25 * sin(t * 11.0) + 0.15 * sin(t * 29.0)
	lamp_light.light_energy = 2.6 * (1.0 + f)
	flame.scale = Vector3(1, 1.0 + f * 1.5, 1)

	if not dragging:
		var h := _pick()
		if h != hovered:
			if hovered:
				hovered.mat.emission = Color(0, 0, 0)
			hovered = h
			if hovered:
				hovered.mat.emission = Color(0.35, 0.16, 0.05)
			Input.set_default_cursor_shape(Input.CURSOR_DRAG if hovered else Input.CURSOR_ARROW)

	if not solved and not solution.is_empty():
		var all_in := true
		for p in pieces:
			all_in = all_in and p.locked
		if (all_in or match_score > 0.9) and dragging == null:
			hold += dt
			if hold > 0.35:
				_solved()
		else:
			hold = 0.0

	_pump_bell()


func _solved() -> void:
	solved = true
	_paint_meter()
	_chime()
	var tw := create_tween()
	tw.tween_property(lamp_light, "light_energy", 5.5, 0.25)
	tw.tween_property(lamp_light, "light_energy", 2.6, 1.2)
	_set_hint("")
	if shots_dir != "":
		return
	await get_tree().create_timer(2.6).timeout
	_start_act(min(act + 1, acts.size() - 1))


# ---------------------------------------------------------------- UI

func _font(names: Array, weight := 400) -> SystemFont:
	var f := SystemFont.new()
	f.font_names = PackedStringArray(names)
	f.font_weight = weight
	return f


func _build_ui() -> void:
	ui = CanvasLayer.new()
	add_child(ui)
	var root := Control.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	ui.add_child(root)
	var title_font := _font(["Baskerville", "Didot", "Georgia"])
	var small_font := _font(["Gill Sans", "Avenir Next", "Helvetica Neue"], 300)

	act_label = Label.new()
	act_label.add_theme_font_override("font", small_font)
	act_label.add_theme_font_size_override("font_size", 15)
	act_label.add_theme_color_override("font_color", Color(PAPER, 0.62))
	act_label.add_theme_constant_override("outline_size", 0)
	act_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	act_label.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
	act_label.position = Vector2(-300, -64)
	act_label.size = Vector2(600, 24)
	act_label.grow_horizontal = Control.GROW_DIRECTION_BOTH
	root.add_child(act_label)

	meter_bg = ColorRect.new()
	meter_bg.color = Color(PAPER, 0.12)
	meter_bg.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
	meter_bg.position = Vector2(-90, -34)
	meter_bg.size = Vector2(180, 2)
	meter_bg.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(meter_bg)
	meter_fill = ColorRect.new()
	meter_fill.size = Vector2(0, 2)
	meter_fill.mouse_filter = Control.MOUSE_FILTER_IGNORE
	meter_bg.add_child(meter_fill)

	hint_label = Label.new()
	hint_label.add_theme_font_override("font", title_font)
	hint_label.add_theme_font_size_override("font_size", 22)
	hint_label.add_theme_color_override("font_color", Color(PAPER, 0.85))
	hint_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	hint_label.set_anchors_preset(Control.PRESET_CENTER_TOP)
	hint_label.position = Vector2(-450, 34)
	hint_label.size = Vector2(900, 40)
	root.add_child(hint_label)

	ask_box = LineEdit.new()
	ask_box.placeholder_text = "a cat on a fence, a ship, a dancing figure…"
	ask_box.add_theme_font_override("font", title_font)
	ask_box.add_theme_font_size_override("font_size", 22)
	ask_box.add_theme_color_override("font_color", PAPER)
	ask_box.add_theme_color_override("font_placeholder_color", Color(PAPER, 0.35))
	ask_box.add_theme_color_override("caret_color", FLAME)
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(0, 0, 0, 0.0)
	sb.border_color = Color(PAPER, 0.35)
	sb.border_width_bottom = 1
	sb.content_margin_left = 6
	sb.content_margin_bottom = 6
	ask_box.add_theme_stylebox_override("normal", sb)
	ask_box.add_theme_stylebox_override("focus", sb)
	ask_box.alignment = HORIZONTAL_ALIGNMENT_CENTER
	ask_box.set_anchors_preset(Control.PRESET_CENTER_TOP)
	ask_box.position = Vector2(-280, 84)
	ask_box.size = Vector2(560, 44)
	ask_box.visible = false
	ask_box.text_submitted.connect(_ask)
	root.add_child(ask_box)

	# silent-film intertitle between acts
	card_root = Control.new()
	card_root.set_anchors_preset(Control.PRESET_FULL_RECT)
	card_root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	card_root.modulate.a = 0.0
	root.add_child(card_root)
	var shade := ColorRect.new()
	shade.color = Color(0.01, 0.008, 0.008, 0.94)
	shade.set_anchors_preset(Control.PRESET_FULL_RECT)
	shade.mouse_filter = Control.MOUSE_FILTER_IGNORE
	card_root.add_child(shade)
	for inset in [Vector2(70, 70), Vector2(80, 80)]:
		var border := Panel.new()
		var bs := StyleBoxFlat.new()
		bs.bg_color = Color(0, 0, 0, 0)
		bs.border_color = Color(PAPER, 0.5)
		bs.set_border_width_all(1)
		border.add_theme_stylebox_override("panel", bs)
		border.set_anchors_preset(Control.PRESET_FULL_RECT)
		border.offset_left = inset.x
		border.offset_top = inset.y
		border.offset_right = -inset.x
		border.offset_bottom = -inset.y
		border.mouse_filter = Control.MOUSE_FILTER_IGNORE
		card_root.add_child(border)
	card_sub = Label.new()
	card_sub.add_theme_font_override("font", title_font)
	card_sub.add_theme_font_size_override("font_size", 26)
	card_sub.add_theme_color_override("font_color", Color(PAPER, 0.7))
	card_sub.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	card_sub.set_anchors_preset(Control.PRESET_CENTER)
	card_sub.position = Vector2(-400, -80)
	card_sub.size = Vector2(800, 40)
	card_root.add_child(card_sub)
	card_title = Label.new()
	card_title.add_theme_font_override("font", title_font)
	card_title.add_theme_font_size_override("font_size", 72)
	card_title.add_theme_color_override("font_color", PAPER)
	card_title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	card_title.set_anchors_preset(Control.PRESET_CENTER)
	card_title.position = Vector2(-700, -30)
	card_title.size = Vector2(1400, 100)
	card_root.add_child(card_title)

	http = HTTPRequest.new()
	http.timeout = 90
	add_child(http)
	http.request_completed.connect(_on_answer)


func _intertitle(sub: String, title: String) -> void:
	card_sub.text = "—  %s  —" % sub
	card_title.text = title
	var tw := create_tween()
	card_root.modulate.a = 1.0
	tw.tween_interval(1.4 if shots_dir == "" else 0.0)
	tw.tween_property(card_root, "modulate:a", 0.0, 0.9 if shots_dir == "" else 0.01)


# ---------------------------------------------------------------- sound

func _build_audio() -> void:
	bell = AudioStreamPlayer.new()
	var g := AudioStreamGenerator.new()
	g.mix_rate = 44100
	g.buffer_length = 0.3
	bell.stream = g
	bell.volume_db = -8
	add_child(bell)
	bell.play()


func _synth(freqs: Array, dur: float, gain: float) -> void:
	var n := int(44100 * dur)
	var start := bell_queue.size()
	if bell_queue.size() < n:
		bell_queue.resize(n)
		for i in range(start, n):
			bell_queue[i] = Vector2.ZERO
	for i in n:
		var tt := i / 44100.0
		var v := 0.0
		for j in freqs.size():
			v += sin(TAU * freqs[j] * tt) * exp(-tt * (2.5 + j * 1.8)) / (j + 1)
		v *= gain * min(1.0, tt * 400.0)
		bell_queue[i] += Vector2(v, v)


func _chime() -> void:
	_synth([523.25, 784.0, 1046.5, 1568.0], 2.2, 0.22)


func _tick() -> void:
	_synth([1318.5, 2637.0], 0.18, 0.12)


func _pump_bell() -> void:
	var pb := bell.get_stream_playback() as AudioStreamGeneratorPlayback
	if pb == null:
		return
	var n: int = min(pb.get_frames_available(), bell_queue.size())
	if n > 0:
		pb.push_buffer(bell_queue.slice(0, n))
		bell_queue = bell_queue.slice(n)
	var fill: int = pb.get_frames_available()
	if fill > 0 and bell_queue.is_empty():
		var z := PackedVector2Array()
		z.resize(min(fill, 512))
		pb.push_buffer(z)


# ---------------------------------------------------------------- Ask the Lamp (Nemotron)

func _api_key() -> String:
	# Read at runtime from the environment only; the key is never stored in the project.
	return OS.get_environment("NEBIUS_API_KEY").strip_edges()


func _ask(text: String) -> void:
	text = text.strip_edges()
	if text == "" or thinking:
		return
	var key := _api_key()
	if key == "":
		_set_hint("No model key. Set NEBIUS_API_KEY and try again.")
		return
	thinking = true
	ask_box.editable = false
	_set_hint("The lamp is thinking…")
	var sys := "You design shadow-puppet figures made from flat black card shapes held in front of a lamp. " \
		+ "The shadow screen spans x from -1.4 to 1.4 and y from 0.3 to 2.0 (metres, y up). " \
		+ "Reply with JSON only, no prose: {\"title\": string, \"pieces\": [{\"shape\": \"disc\"|\"ellipse\"|\"rect\"|\"tri\", " \
		+ "\"w\": number, \"h\": number, \"x\": number, \"y\": number, \"rot\": number}]}. " \
		+ "x,y is the centre of that piece's shadow; w,h its shadow width and height (0.05 to 0.9; disc and tri use w only); rot in degrees. " \
		+ "tri is an isosceles triangle pointing up at rot 0 (w = base, h = height); rotate it for sails, ears, beaks, wings. " \
		+ "Use 3 to 7 pieces that overlap into ONE clear recognisable side-view silhouette, centred near x=0, y=1.1. " \
		+ "Think like a shadow puppeteer: the outline is all that shows, so exaggerate the parts that identify the subject " \
		+ "and keep the rest simple. Example, a sitting cat: {\"title\": \"Cat\", \"pieces\": [" \
		+ "{\"shape\":\"ellipse\",\"w\":0.62,\"h\":0.36,\"x\":-0.05,\"y\":0.65,\"rot\":0}," \
		+ "{\"shape\":\"disc\",\"w\":0.34,\"h\":0.34,\"x\":0.3,\"y\":0.95,\"rot\":0}," \
		+ "{\"shape\":\"tri\",\"w\":0.13,\"h\":0.2,\"x\":0.2,\"y\":1.15,\"rot\":12}," \
		+ "{\"shape\":\"tri\",\"w\":0.13,\"h\":0.2,\"x\":0.4,\"y\":1.15,\"rot\":-12}," \
		+ "{\"shape\":\"ellipse\",\"w\":0.07,\"h\":0.6,\"x\":-0.5,\"y\":0.85,\"rot\":28}]}"
	ask_word = text
	ask_round = 0
	ask_first = []
	ask_msgs = [{"role": "system", "content": sys}, {"role": "user", "content": "Make: " + text}]
	ask_headers = ["Content-Type: application/json", "Authorization: Bearer " + key]
	_send()


func _send() -> void:
	var body := {
		"model": "nvidia/Nemotron-3.5-Super-VL",
		"temperature": 0.4,
		# Nemotron is a reasoning model: reasoning tokens count against max_tokens, so leave ample headroom.
		"max_tokens": 8000,
		"messages": ask_msgs,
	}
	var err := http.request("https://api.tokenfactory.nebius.com/v1/chat/completions", ask_headers, HTTPClient.METHOD_POST, JSON.stringify(body))
	if err != OK:
		_ask_failed("Could not reach the model (%d)." % err)


# The exact shadow a figure casts, as the model will see it: black on white paper.
func _silhouette_png(sol: Array) -> String:
	var size := Vector2i(448, 280)
	var polys := []
	for d in sol:
		polys.append(_project(d["poly"], d["pos"], d["rot"]))
	var m := _raster(polys, size)
	var img := Image.create(size.x, size.y, false, Image.FORMAT_L8)
	for y in size.y:
		for x in size.x:
			img.set_pixel(x, size.y - 1 - y, Color.BLACK if m[y * size.x + x] == 1 else Color.WHITE)
	return Marshalls.raw_to_base64(img.save_png_to_buffer())


func _ask_failed(msg: String) -> void:
	thinking = false
	ask_box.editable = true
	_set_hint(msg)


func _on_answer(result: int, code: int, _h: PackedStringArray, raw: PackedByteArray) -> void:
	if result != HTTPRequest.RESULT_SUCCESS or code != 200:
		_ask_failed("The model did not answer (HTTP %d). Try again." % code)
		return
	var resp = JSON.parse_string(raw.get_string_from_utf8())
	var content := ""
	if resp is Dictionary and resp.has("choices"):
		content = str(resp["choices"][0]["message"].get("content", ""))
	var a := content.find("{")
	var b := content.rfind("}")
	var fig = JSON.parse_string(content.substr(a, b - a + 1)) if a >= 0 and b > a else null
	var built := _build_from_model(fig)
	if ask_round == 0:
		if built.is_empty():
			_ask_failed("That answer wasn't a usable figure. Try another word.")
			return
		# Let the model look at the shadow it actually made and correct it once.
		ask_first = built
		ask_title = str(fig.get("title", ask_word))
		ask_round = 1
		_set_hint("The lamp is looking at its shadow…")
		ask_msgs.append({"role": "assistant", "content": content})
		ask_msgs.append({"role": "user", "content": [
			{"type": "text", "text": "This image is the exact shadow your pieces cast on the screen (black on white, the full screen). " \
				+ "Would a stranger name it as \"" + ask_word + "\" at a glance? Fix whatever stops it reading: proportions, placement, " \
				+ "missing identifying parts, pieces that blob together. Reply with the complete revised JSON only."},
			{"type": "image_url", "image_url": {"url": "data:image/png;base64," + _silhouette_png(built)}}]})
		_send()
		return
	if built.is_empty():
		built = ask_first
	else:
		ask_title = str(fig.get("title", ask_title))
	thinking = false
	ask_box.editable = true
	ask_box.release_focus()
	_play_custom(ask_title, built)


# The model proposes shadows; the game turns each one into a real card at a
# real depth, so the figure you are shown is always one the cards can make.
func _build_from_model(fig) -> Array:
	if not (fig is Dictionary) or not (fig.get("pieces") is Array):
		return []
	var out := []
	var depths := [1.6, 1.4, 1.8, 1.6, 1.2, 2.0, 1.5]
	var i := 0
	for d in fig["pieces"]:
		if not (d is Dictionary) or out.size() >= 7:
			continue
		var z: float = depths[i % depths.size()]
		i += 1
		var k := LAMP.z / (LAMP.z - z)
		var sw := clampf(float(d.get("w", 0.2)), 0.05, 0.9) / k
		var sh := clampf(float(d.get("h", d.get("w", 0.2))), 0.05, 0.9) / k
		var sx := clampf(float(d.get("x", 0.0)), -1.3, 1.3)
		var sy := clampf(float(d.get("y", 1.1)), 0.35, 1.95)
		var shape := {}
		match str(d.get("shape", "")):
			"disc": shape = _shape("disc", sw / 2.0)
			"ellipse": shape = _shape("ellipse", sw / 2.0, sh / 2.0)
			"rect": shape = _shape("rect", sw, sh)
			"tri": shape = _shape("tri", sw, sh)
			_: continue
		shape["pos"] = _from_shadow(Vector2(sx, sy), z)
		shape["rot"] = deg_to_rad(float(d.get("rot", 0.0)))
		out.append(shape)
	return out if out.size() >= 2 else []


func _play_custom(title: String, sol: Array) -> void:
	var starts := []
	var spots := [Vector2(-1.1, 0.5), Vector2(1.1, 0.5), Vector2(-1.15, 1.7), Vector2(1.15, 1.7), Vector2(-0.6, 0.4), Vector2(0.6, 0.4), Vector2(0, 1.95)]
	for j in sol.size():
		starts.append([spots[j], sol[j]["pos"].z, rad_to_deg(sol[j]["rot"]) + 35.0 * (1 if j % 2 == 0 else -1)])
	var a: Dictionary = acts[acts.size() - 1]
	acts[acts.size() - 1] = {"name": title, "hint": "", "sol": sol, "start": starts, "ask": true, "proposal": a}
	_start_act(acts.size() - 1)


# ---------------------------------------------------------------- screenshots for review

func _snap_to_solution(n: int) -> void:
	for j in min(n, pieces.size()):
		pieces[j].pos = solution[j]["pos"]
		pieces[j].rot = solution[j]["rot"]
		pieces[j].locked = true
		_place(pieces[j])
	_update_match()


func _shot(name: String) -> void:
	await RenderingServer.frame_post_draw
	await get_tree().process_frame
	await RenderingServer.frame_post_draw
	get_viewport().get_texture().get_image().save_png(shots_dir.path_join(name + ".png"))


func _run_shots() -> void:
	DirAccess.make_dir_recursive_absolute(shots_dir)
	await get_tree().create_timer(1.0).timeout
	await _shot("1-moon-start")
	_start_act(3)
	await get_tree().create_timer(0.6).timeout
	await _shot("2-hare-start")
	_snap_to_solution(3)
	await get_tree().create_timer(0.3).timeout
	await _shot("3-hare-half")
	_snap_to_solution(5)
	await get_tree().create_timer(0.8).timeout
	await _shot("4-hare-solved")
	_start_act(4)
	_snap_to_solution(5)
	await get_tree().create_timer(0.8).timeout
	await _shot("5-cat-solved")
	_start_act(5)
	await get_tree().create_timer(0.4).timeout
	await _shot("6-ask")
	get_tree().quit()


func _run_ask_test() -> void:
	DirAccess.make_dir_recursive_absolute(shots_dir)
	_start_act(acts.size() - 1)
	await get_tree().create_timer(0.5).timeout
	_ask(ask_test)
	var waited := 0.0
	while thinking and waited < 120.0:
		await get_tree().create_timer(0.5).timeout
		waited += 0.5
	print("ASK_RESULT round=", ask_round, " title=", acts[acts.size() - 1]["name"], " pieces=", solution.size(), " hint=", hint_label.text, " secs=", waited)
	_snap_to_solution(solution.size())
	await get_tree().create_timer(0.8).timeout
	await _shot("ask-" + ask_test.replace(" ", "-") + "-2-revised")
	if not ask_first.is_empty():
		_play_custom("first draft", ask_first)
		_snap_to_solution(solution.size())
		await get_tree().create_timer(0.8).timeout
		await _shot("ask-" + ask_test.replace(" ", "-") + "-1-first")
	get_tree().quit()
