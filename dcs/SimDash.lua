-- SimDash export for DCS World
-- Streams flight data (attitude, speeds, engines, gear...) to the SimDash bridge
-- as small JSON packets over UDP 127.0.0.1:7790, ~30 times per second.
--
-- Installed by install-dcs.bat into  Saved Games\DCS\Scripts\SimDash\SimDash.lua
-- and loaded from Export.lua. It chains the export hooks, so it runs side by side
-- with DCS-BIOS, MOZA, SimShaker, TacView, etc.

local SimDash = { host = "127.0.0.1", port = 7790, period = 1 / 30, nextTime = 0 }
local R2D = 57.29577951

local function num(v)
	if type(v) ~= "number" or v ~= v or v == math.huge or v == -math.huge then
		return nil
	end
	return string.format("%.3f", v)
end

function SimDash.collect()
	local parts = {}
	local function put(key, value)
		local s = num(value)
		if s then
			parts[#parts + 1] = '"' .. key .. '":' .. s
		end
	end

	local me = LoGetSelfData and LoGetSelfData() or nil
	local name = me and me.Name or ""

	local pitch, bank = LoGetADIPitchBankYaw()
	if pitch then
		put("pitch", pitch * R2D)
		put("roll", bank * R2D)
	end
	local hdg = LoGetMagneticYaw and LoGetMagneticYaw() or (me and me.Heading)
	if hdg then put("heading", (hdg * R2D) % 360) end

	local ias = LoGetIndicatedAirSpeed(); if ias then put("ias", ias * 1.943844) end
	local asl = LoGetAltitudeAboveSeaLevel(); if asl then put("alt", asl * 3.28084) end
	local agl = LoGetAltitudeAboveGroundLevel(); if agl then put("radalt", agl * 3.28084) end
	local vv = LoGetVerticalVelocity(); if vv then put("vs", vv * 196.8504) end
	put("mach", LoGetMachNumber())
	local aoa = LoGetAngleOfAttack(); if aoa then put("aoa", aoa * R2D) end
	local acc = LoGetAccelerationUnits(); if acc then put("g", acc.y) end
	put("slip", LoGetSlipBallPosition())
	local av = LoGetAngularVelocity(); if av then put("turn", av.y * R2D * 6.67) end

	local eng = LoGetEngineInfo()
	if eng then
		if eng.RPM then
			put("n1", eng.RPM.left)
			put("n2", eng.RPM.right)
			put("rpm", eng.RPM.left)
		end
		if eng.Temperature then
			put("egt", eng.Temperature.left)
			put("egt_r", eng.Temperature.right)
		end
		if eng.FuelConsumption then put("fuel_flow", (eng.FuelConsumption.left or 0) + (eng.FuelConsumption.right or 0)) end
		put("fuel_int", eng.fuel_internal)
		put("fuel_ext", eng.fuel_external)
	end

	local mech = LoGetMechInfo()
	if mech then
		local g = mech.gear
		if g then
			put("gear", g.value)
			local m = g.main or {}
			put("gear_n", m.nose and m.nose.rod or g.value)
			put("gear_l", m.left and m.left.rod or g.value)
			put("gear_r", m.right and m.right.rod or g.value)
		end
		if mech.flaps then put("flaps", mech.flaps.value) end
		if mech.speedbrakes then put("speedbrake", mech.speedbrakes.value) end
		if mech.hook then put("hook", mech.hook.value) end
		if mech.canopy then put("canopy", mech.canopy.value) end
	end

	local snares = LoGetSnares and LoGetSnares() or nil
	if snares then
		put("chaff", snares.chaff)
		put("flare", snares.flare)
	end
	local payload = LoGetPayloadInfo and LoGetPayloadInfo() or nil
	if payload and payload.Cannon then put("gun", payload.Cannon.shells) end

	local safeName = string.gsub(name, '[%c"\\]', "")
	return '{"a":"' .. safeName .. '",' .. table.concat(parts, ",") .. "}"
end

function SimDash.start()
	package.path = package.path .. ";.\\LuaSocket\\?.lua"
	package.cpath = package.cpath .. ";.\\LuaSocket\\?.dll"
	local socket = require("socket")
	SimDash.udp = socket.udp()
	SimDash.udp:settimeout(0)
	SimDash.udp:setpeername(SimDash.host, SimDash.port)
end

function SimDash.frame()
	local t = LoGetModelTime()
	if not SimDash.udp or t < SimDash.nextTime then
		return
	end
	SimDash.nextTime = t + SimDash.period
	local ok, packet = pcall(SimDash.collect)
	if ok and packet then
		SimDash.udp:send(packet)
	end
end

function SimDash.stop()
	if SimDash.udp then
		pcall(function() SimDash.udp:send('{"a":""}') end)
		SimDash.udp:close()
		SimDash.udp = nil
	end
end

-- chain the export hooks so other exporters keep working
do
	local prevStart = LuaExportStart
	local prevAfter = LuaExportAfterNextFrame
	local prevStop = LuaExportStop

	LuaExportStart = function()
		if prevStart then prevStart() end
		pcall(SimDash.start)
	end

	LuaExportAfterNextFrame = function()
		if prevAfter then prevAfter() end
		pcall(SimDash.frame)
	end

	LuaExportStop = function()
		pcall(SimDash.stop)
		if prevStop then prevStop() end
	end
end
