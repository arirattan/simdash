/*
 * Checklists for the Flight bag. Generic, sim-oriented flows written for SimDash -
 * always follow the aircraft's own POH / sim documentation where it differs.
 * Format: { 'Aircraft': [ ['SECTION', [['Item', 'Action'], ...]], ... ] }
 */
(function (global) {
  'use strict';
  global.CHECKLISTS = {
    'Cessna 152 / 172 (piston)': [
      ['BEFORE START', [['Preflight / walk-around', 'COMPLETE'], ['Seats & belts', 'ADJUSTED, LOCKED'], ['Fuel selector', 'BOTH'], ['Circuit breakers', 'IN'], ['Avionics master', 'OFF'], ['Brakes', 'SET'], ['Doors', 'CLOSED & LATCHED']]],
      ['ENGINE START', [['Mixture', 'RICH'], ['Carb heat', 'COLD'], ['Throttle', 'OPEN ¼ INCH'], ['Master switch', 'ON'], ['Beacon', 'ON'], ['Prop area', 'CLEAR'], ['Magnetos', 'START, then BOTH'], ['Oil pressure', 'GREEN within 30 s'], ['Avionics master', 'ON'], ['Flaps', 'UP']]],
      ['BEFORE TAXI', [['ATIS / clearance', 'RECEIVED'], ['Altimeter', 'SET'], ['Heading indicator', 'SET TO COMPASS'], ['Taxi light', 'ON'], ['Brakes', 'CHECK']]],
      ['RUN-UP', [['Parking brake', 'SET'], ['Throttle', '1700 RPM'], ['Magnetos', 'CHECK (max drop 125, diff 50)'], ['Carb heat', 'CHECK, then COLD'], ['Suction', 'GREEN'], ['Engine instruments', 'GREEN'], ['Throttle', 'IDLE CHECK, then 1000'], ['Flight controls', 'FREE & CORRECT'], ['Trim', 'TAKEOFF'], ['Fuel selector', 'BOTH']]],
      ['BEFORE TAKEOFF', [['Flaps', '0–10°'], ['Transponder', 'ALT'], ['Lights', 'LANDING, STROBE ON'], ['Mixture', 'RICH (lean above 3000 ft DA)'], ['Takeoff briefing', 'COMPLETE']]],
      ['CLIMB', [['Airspeed', '70–80 KIAS'], ['Flaps', 'UP'], ['Throttle', 'FULL'], ['Mixture', 'LEAN AS REQUIRED']]],
      ['CRUISE', [['Power', '2200–2400 RPM'], ['Mixture', 'LEAN'], ['Trim', 'SET'], ['Fuel', 'MONITOR (tank timer)']]],
      ['DESCENT / APPROACH', [['ATIS', 'RECEIVED'], ['Altimeter', 'SET'], ['Fuel selector', 'BOTH'], ['Mixture', 'ENRICHEN'], ['Carb heat', 'ON below green arc']]],
      ['BEFORE LANDING', [['Seats & belts', 'SECURE'], ['Mixture', 'RICH'], ['Carb heat', 'ON'], ['Flaps', 'AS REQUIRED'], ['Airspeed', '65 KIAS final (full flaps)']]],
      ['AFTER LANDING', [['Flaps', 'UP'], ['Carb heat', 'COLD'], ['Transponder', 'STBY'], ['Lights', 'TAXI ON, STROBE OFF']]],
      ['SHUTDOWN', [['Parking brake', 'SET'], ['Avionics master', 'OFF'], ['Electrical equipment', 'OFF'], ['Throttle', 'IDLE'], ['Mixture', 'IDLE CUT-OFF'], ['Magnetos', 'OFF'], ['Master switch', 'OFF'], ['Fuel selector', 'LEFT or RIGHT']]],
    ],
    'Cessna 172 G1000': [
      ['BEFORE START', [['Preflight', 'COMPLETE'], ['Fuel selector', 'BOTH'], ['Fuel shutoff valve', 'ON (in)'], ['Avionics switches', 'OFF'], ['Brakes', 'SET']]],
      ['ENGINE START', [['Throttle', 'OPEN ¼ INCH'], ['Mixture', 'IDLE CUT-OFF'], ['Standby battery', 'TEST, then ARM'], ['Master switch (ALT & BAT)', 'ON'], ['Beacon', 'ON'], ['Aux fuel pump', 'ON 3–5 s (cold), then OFF'], ['Magnetos', 'START'], ['Mixture', 'ADVANCE SMOOTHLY TO RICH'], ['Oil pressure', 'CHECK (EIS)'], ['Avionics', 'ON'], ['PFD/MFD', 'CHECK, no red X']]],
      ['BEFORE TAKEOFF', [['Run-up 1800 RPM', 'MAGS, SUCTION, VOLTS'], ['Autopilot', 'PREFLIGHT TEST / OFF'], ['Flight plan / NAV source', 'SET (GPS or LOC)'], ['Heading bug', 'RUNWAY'], ['Altitude select', 'SET'], ['Flaps', '0–10°'], ['Transponder', 'ALT'], ['Lights', 'ON']]],
      ['APPROACH', [['Approach loaded', 'PROC › ACTIVATE'], ['Minimums', 'SET (TMR/REF)'], ['CDI', 'CHECK SOURCE'], ['Altimeter', 'SET']]],
      ['SHUTDOWN', [['Avionics', 'OFF'], ['Mixture', 'IDLE CUT-OFF'], ['Magnetos', 'OFF'], ['Master', 'OFF'], ['Standby battery', 'OFF']]],
    ],
    'Cub / Beaver / bush plane': [
      ['BEFORE START', [['Fuel', 'ON / tank selected'], ['Primer', 'AS REQUIRED'], ['Trim', 'TAKEOFF'], ['Flaps', 'UP'], ['Stick', 'AFT (taildragger)']]],
      ['ENGINE START', [['Mixture', 'RICH'], ['Throttle', 'CRACKED'], ['Master', 'ON'], ['Magnetos', 'BOTH, START'], ['Oil pressure', 'GREEN']]],
      ['SHORT FIELD TAKEOFF', [['Flaps', 'AS PER TYPE (1 notch)'], ['Brakes', 'HOLD, FULL POWER'], ['Tail', 'UP EARLY, fly off at minimum speed'], ['Obstacle', 'CLEAR, accelerate, flaps UP']]],
      ['BACKCOUNTRY LANDING', [['Strip', 'OVERFLY & INSPECT'], ['Wind', 'CHECK'], ['Approach', 'STABLE, slow, full flaps'], ['Touchdown', '3-POINT / wheel'], ['Stick', 'FULL AFT after touchdown']]],
      ['SHUTDOWN', [['Mixture', 'CUT-OFF'], ['Magnetos', 'OFF'], ['Master', 'OFF'], ['Fuel', 'OFF']]],
    ],
    'Cessna 208 Caravan / PC-6 (turboprop)': [
      ['BEFORE START', [['Fuel tank selectors', 'BOTH ON'], ['Fuel condition lever', 'CUT-OFF'], ['Prop lever', 'FULL FORWARD'], ['Power lever', 'IDLE'], ['Battery', 'ON'], ['Fuel boost pump', 'ON/NORM']]],
      ['ENGINE START', [['Beacon', 'ON'], ['Starter', 'START'], ['Ng', 'ABOVE 12–14%'], ['Condition lever', 'LOW IDLE'], ['ITT', 'MONITOR (limit!)'], ['Starter', 'OFF at ~46% Ng'], ['Generator', 'ON'], ['Avionics', 'ON']]],
      ['BEFORE TAKEOFF', [['Condition lever', 'HIGH IDLE'], ['Flaps', '20°'], ['Trim', 'SET'], ['Inertial separator', 'AS REQUIRED'], ['Transponder', 'ALT']]],
      ['TAKEOFF', [['Power', 'SET TORQUE (do not exceed ITT/torque)'], ['Rotate', 'Vr'], ['Flaps', 'UP after 100 KIAS']]],
      ['SHUTDOWN', [['Power lever', 'IDLE'], ['ITT', 'STABILIZE 1 min'], ['Condition lever', 'CUT-OFF'], ['Avionics', 'OFF'], ['Battery', 'OFF']]],
    ],
    'Air Tractor AT-802 (ag / fire)': [
      ['BEFORE START', [['Hopper', 'LOADED / quantity checked'], ['Dump gate / spray valve', 'CLOSED'], ['Condition lever', 'CUT-OFF'], ['Battery', 'ON']]],
      ['START', [['Starter', 'ENGAGE'], ['Condition lever', 'LOW IDLE at 12% Ng'], ['ITT', 'MONITOR'], ['Generator', 'ON']]],
      ['SPRAY RUN', [['Swath / GPS guidance', 'SET'], ['Height', '8–15 ft AGL'], ['Airspeed', 'WORKING SPEED'], ['Spray valve', 'ON over the field, OFF at the end'], ['Turn', 'PROCEDURE TURN, watch bank & speed']]],
      ['FIRE DROP', [['Drop coverage level', 'SET'], ['Run-in', 'INTO WIND if possible'], ['Height', 'AS BRIEFED'], ['Drop', 'ON TARGET'], ['After drop', 'POWER UP, CLIMB AWAY']]],
      ['EMERGENCY', [['Load', 'DUMP (jettison) if needed'], ['Field', 'SELECT'], ['Engine failure', 'CONDITION CUT-OFF, glide']]],
    ],
    'CL-415 / Air Crane (water bomber)': [
      ['SCOOPING RUN', [['Water body', 'LENGTH & OBSTACLES CHECKED'], ['Landing config', 'AS REQUIRED'], ['Touchdown', 'ON STEP'], ['Scoops', 'DOWN'], ['Tank', 'MONITOR %'], ['Scoops', 'UP at full'], ['Power', 'TAKEOFF, lift off']]],
      ['DROP', [['Target', 'IDENTIFIED, lead plane / smoke'], ['Height & speed', 'AS BRIEFED'], ['Doors', 'OPEN over target'], ['After drop', 'CLIMB, clear the smoke']]],
      ['HELI BUCKET / SNORKEL', [['Hover', 'OVER WATER, stable'], ['Snorkel / bucket', 'DOWN, fill'], ['Weight', 'CHECK POWER MARGIN'], ['Drop', 'OVER TARGET, into wind']]],
    ],
    'Helicopter - turbine (H125 / 407 / EC135 / R66)': [
      ['BEFORE START', [['Rotor brake', 'OFF'], ['Throttle / twist grip', 'OFF / IDLE'], ['Collective', 'FULL DOWN, locked'], ['Battery', 'ON'], ['Fuel valve / pumps', 'ON'], ['Warning panel', 'TEST']]],
      ['ENGINE START', [['Area', 'CLEAR, anti-col ON'], ['Starter', 'ON'], ['TOT/ITT', 'MONITOR (abort if limit)'], ['Ng', 'STABLE at idle'], ['Generator', 'ON'], ['Twist grip / FLY', 'FLIGHT at stable idle'], ['NR', '100%']]],
      ['BEFORE TAKEOFF', [['Hydraulics', 'ON / checked'], ['Instruments', 'GREEN'], ['Radalt', 'SET'], ['Doors', 'CLOSED'], ['Hover check', 'POWER MARGIN, controls']]],
      ['CRUISE', [['Torque', 'WITHIN LIMITS'], ['Fuel', 'MONITOR'], ['Engine instruments', 'GREEN']]],
      ['LANDING / HOVER', [['Site', 'RECCE (high & low)'], ['Wind', 'INTO WIND'], ['Approach', 'STEADY ANGLE'], ['Hover', 'STABLE, then lower collective']]],
      ['SHUTDOWN', [['Collective', 'DOWN'], ['Twist grip', 'IDLE, cool 2 min'], ['Engine', 'OFF'], ['Rotor brake', 'BELOW LIMIT RPM'], ['Fuel / battery', 'OFF']]],
    ],
    'Helicopter - piston (Cabri G2 / R44)': [
      ['BEFORE START', [['Governor', 'OFF'], ['Collective', 'DOWN'], ['Mixture', 'RICH'], ['Clutch / belt', 'DISENGAGED'], ['Battery', 'ON']]],
      ['START', [['Throttle', 'CRACKED'], ['Magnetos / key', 'START'], ['Clutch', 'ENGAGE, wait for tension'], ['Governor', 'ON'], ['Rotor RPM', '100%']]],
      ['BEFORE TAKEOFF', [['Carb heat / temps', 'CHECK'], ['Warning lights', 'OUT'], ['Hover', 'MANIFOLD PRESSURE margin']]],
      ['SHUTDOWN', [['Throttle', 'IDLE, cool down'], ['Clutch', 'DISENGAGE'], ['Mixture', 'CUT-OFF'], ['Rotor brake', 'APPLY when slow'], ['Battery', 'OFF']]],
    ],
    'Rescue / HEMS mission': [
      ['MISSION BRIEF', [['Location / coordinates', 'ON MAP (Direct-To)'], ['Weather / wind', 'CHECKED'], ['Fuel', 'MISSION + RESERVE'], ['Hospital / landing site', 'NOTED']]],
      ['EN ROUTE', [['Direct-To', 'SET'], ['Radio', 'CONTACT'], ['Search pattern', 'EXPANDING SQUARE if searching']]],
      ['ON SCENE', [['Site recce', 'WIRES / OBSTACLES'], ['Approach', 'INTO WIND'], ['Hoist / sling', 'CHECK WEIGHT & POWER'], ['Crew', 'CLEAR']]],
      ['RETURN', [['Destination', 'DIRECT-TO'], ['Fuel', 'CHECK'], ['Landing site', 'LIGHTING / WIND']]],
    ],
  };
})(window);
