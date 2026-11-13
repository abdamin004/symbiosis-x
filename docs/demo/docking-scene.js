function createDockingScene(canvas, caption) {
  const ctx = canvas.getContext("2d");
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  const portX = 433;
  const axisY = 166;
  const openGap = 212;
  const approachColor = "#80d9ed";
  const holdColor = "#ffc47a";
  const captureColor = "#9bf1bd";
  let frame;
  let scene;
  let distance = openGap;

  const stars = Array.from({length:96}, (_, i) => [
    (i * 131 + 17) % 760,
    (i * i * 47 + 13) % 320,
    i % 7 === 0 ? 1.5 : .7,
  ]);

  function line(points, color, width = 1) {
    ctx.beginPath();
    points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
  }

  function shape(points, fill, edge) {
    ctx.beginPath();
    points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    if (edge) {
      ctx.lineWidth = 1;
      ctx.strokeStyle = edge;
      ctx.stroke();
    }
  }

  function gradient(x1, y1, x2, y2, colors) {
    const fill = ctx.createLinearGradient(x1, y1, x2, y2);
    colors.forEach(([stop, color]) => fill.addColorStop(stop, color));
    return fill;
  }

  function ring(x, y, rx, ry, stroke, width = 1, fill) {
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, 2 * Math.PI);
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    ctx.strokeStyle = stroke;
    ctx.lineWidth = width;
    ctx.stroke();
  }

  function label(text, x, y, color, size = 13) {
    ctx.font = "600 " + size + "px system-ui, sans-serif";
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }

  function drawSpace() {
    ctx.fillStyle = gradient(0, 0, 630, 320, [[0, "#050a14"], [1, "#0b192d"]]);
    ctx.fillRect(0, 0, 760, 320);
    for (const [x, y, size] of stars) {
      ctx.fillStyle = size > 1 ? "#c6def3aa" : "#8caac47d";
      ctx.fillRect(x, y, size, size);
    }

    const earthX = 534;
    const earthY = 692;
    const earthRadius = 456;
    const earth = ctx.createRadialGradient(earthX, earthY, 350, earthX, earthY, earthRadius);
    earth.addColorStop(0, "#0b182a");
    earth.addColorStop(.76, "#112846");
    earth.addColorStop(.96, "#27638c");
    earth.addColorStop(1, "#7fbddc");
    ring(earthX, earthY, earthRadius + 3, earthRadius + 3, "#51b6f325", 4);
    ring(earthX, earthY, earthRadius, earthRadius, "#83d3f869", 1, earth);
    ctx.save();
    ctx.beginPath();
    ctx.arc(earthX, earthY, earthRadius - 2, 0, 2 * Math.PI);
    ctx.clip();
    ctx.beginPath();
    ctx.moveTo(125, 319);
    ctx.bezierCurveTo(330, 261, 478, 315, 659, 253);
    ctx.bezierCurveTo(626, 298, 477, 309, 345, 303);
    ctx.bezierCurveTo(248, 301, 210, 317, 125, 325);
    ctx.fillStyle = "#8caecb24";
    ctx.fill();
    ctx.restore();
  }

  function drawSolarWing(x, y, length, skew) {
    ctx.save();
    const direction = Math.sign(length);
    length = Math.abs(length);
    ctx.transform(1, .14, skew / length, direction, x, y);
    const cells = gradient(-18, 0, 18, length, [[0, "#b38452"], [.48, "#6d4839"], [1, "#392b3b"]]);
    for (const left of [-19, 3]) {
      shape([[left, 0], [left + 16, 0], [left + 16, length], [left, length]], cells, "#d0a675");
      for (let row = 7; row < length; row += 7) {
        line([[left, row], [left + 16, row]], "#e3bc846e");
      }
      line([[left + 8, 0], [left + 8, length]], "#deb88962");
    }
    line([[0, 0], [0, length]], "#a1acb4", 2);
    ctx.restore();
  }

  function drawModule(x, y, length, radius, accent = "#a8bdce") {
    const hull = gradient(0, y - radius, 0, y + radius, [
      [0, "#eaf1f3"], [.28, accent], [.7, "#63798b"], [1, "#354755"],
    ]);
    shape([
      [x, y - radius + 4], [x + 8, y - radius], [x + length - 7, y - radius],
      [x + length, y - radius + 5], [x + length, y + radius - 5],
      [x + length - 7, y + radius], [x + 8, y + radius], [x, y + radius - 4],
    ], hull, "#b8c9d6");
    line([[x + 8, y - radius + 3], [x + 8, y + radius - 3]], "#e4e9ec89", 2);
    line([[x + length - 9, y - radius + 2], [x + length - 9, y + radius - 2]], "#263b5099", 2);
    line([[x + 10, y + radius - 4], [x + length - 10, y + radius - 4]], "#273d4e99");
  }

  function drawStation() {
    // Eight amber wings around the long, braced truss and a separate pressurized spine.
    for (const [x, y] of [[412, 105], [448, 110], [662, 111], [699, 106]]) {
      drawSolarWing(x, y, -67, -20);
      drawSolarWing(x, y, 88, 20);
    }
    for (const [x, y] of [[488, 113], [636, 119]]) {
      const radiator = gradient(x, y - 46, x + 17, y, [[0, "#c7d6e4"], [1, "#495a71"]]);
      shape([[x, y], [x - 18, y - 43], [x + 2, y - 49], [x + 20, y - 6]], radiator, "#9cafc1");
      for (let i = 1; i < 5; i++) {
        line([[x - 3 * i, y - 7 * i], [x + 20 - 3 * i, y - 6 - 7 * i]], "#657d95");
      }
    }
    const truss = gradient(0, 103, 0, 128, [[0, "#a4b3bf"], [.52, "#495e72"], [1, "#17293e"]]);
    shape([[392, 102], [543, 113], [720, 101], [719, 115], [543, 128], [392, 115]], truss, "#9fb1c1");
    for (let x = 399; x < 715; x += 15) {
      const top = 102 + 11 * (1 - Math.abs(x - 543) / (x < 543 ? 151 : 177));
      line([[x, top], [x + 7, top + 12], [x + 14, top]], "#cbdae29c", 1.3);
    }
    line([[520, 123], [510, 160], [562, 159], [549, 124], [520, 123], [550, 156]], "#8196a9", 4);

    // The offset lab, cupola and folded arm break up the central module silhouette.
    drawModule(509, 185, 56, 10, "#c0c4bc");
    drawModule(539, 207, 38, 11);
    shape([[538, 205], [545, 193], [566, 193], [578, 205]], "#5d7281", "#c0ccd6");
    shape([[547, 197], [562, 197], [569, 203], [544, 203]], "#152e44", "#96bed2");
    drawModule(623, 178, 67, 9, "#bfb5a0");
    drawModule(465, axisY, 58, 13);
    drawModule(514, axisY, 49, 17, "#d9e1e4");
    drawModule(557, axisY, 64, 14);
    drawModule(614, axisY, 45, 10, "#c5bdac");
    drawModule(435, axisY, 39, 8);
    ring(portX + 3, axisY, 3, 9, "#eaf4fa", 2, "#2c4459");

    const arm = [[559, 151], [582, 130], [609, 140], [619, 130]];
    line(arm, "#344b60", 7);
    line(arm, "#c5d2d7", 4);
    for (const [x, y] of arm.slice(0, -1)) ring(x, y, 3, 3, "#bac7cd", 1, "#556b80");
    label("ISS", 531, 170, "#152738", 11);
  }

  function drawShip(noseX, tilt, ship) {
    ctx.save();
    ctx.translate(noseX, axisY);
    ctx.rotate(tilt);
    const hull = gradient(0, -25, 0, 25, [
      [0, "#e7f0f3"], [.3, "#b8c9d5"], [.62, "#768d9f"], [1, "#34495d"],
    ]);
    const service = gradient(0, -22, 0, 22, [[0, "#90a8bc"], [.45, "#5c7388"], [1, "#28394b"]]);
    shape([[-123, -12], [-114, -16], [-114, 16], [-123, 12]], "#253b53", "#8ba7be");
    shape([[-114, -18], [-79, -22], [-75, 21], [-114, 18]], service, "#adc1cf");
    shape([[-79, -23], [-56, -23], [-15, -10], [-7, -7], [0, -6],
      [0, 6], [-7, 7], [-15, 10], [-56, 23], [-79, 23]], hull, "#e0e9ef");
    shape([[-48, -17], [-27, -12], [-26, -8], [-47, -10]], "#0f2c43", "#9dccdd");
    line([[-108, -15], [-108, 15]], "#c4d9e3", 2);
    line([[-79, -21], [-79, 21]], "#22364c", 3);
    line([[-7, -6], [-7, 6]], "#263f55", 2);
    label(ship.toUpperCase(), -72, 8, "#152738", 11);
    ctx.restore();
  }

  function drawGuidance(noseX, phase, color) {
    ctx.setLineDash([5, 6]);
    line([[72, axisY], [portX - 6, axisY]], color + "90");
    ctx.setLineDash([]);
    const direction = phase === "departure" ? -1 : 1;
    for (let x = noseX + 20; x < portX - 13; x += 27) {
      if (phase === "held") {
        line([[x, axisY - 5], [x, axisY + 5]], color, 2);
      } else {
        line([[x - 4 * direction, axisY - 4], [x, axisY], [x - 4 * direction, axisY + 4]], color, 1.5);
      }
    }
    label("Docking axis", 77, axisY - 44, color);
  }

  function drawPortCue(phase, gap, captureFlash, color) {
    const latched = phase === "captured" && gap <= .5;
    const brackets = latched ? 10 : 15;
    for (const side of [-1, 1]) {
      const y = axisY + side * brackets;
      line([[portX - 9, y - side * 4], [portX - 9, y], [portX + 9, y],
        [portX + 9, y - side * 4]], color, 2);
    }
    if (latched) {
      line([[portX, axisY - 6], [portX, axisY + 6]], captureColor, 3);
      if (captureFlash > 0) {
        const radius = 13 + (1 - captureFlash) * 20;
        ctx.save();
        ctx.globalAlpha = captureFlash;
        ring(portX, axisY, radius, radius, captureColor, 2.5);
        ctx.restore();
      }
    }
    if (latched || phase === "held") {
      const text = latched ? "Capture latched" : "Hold position";
      line([[portX, axisY + brackets + 3], [portX - 16, 221], [portX - 25, 221]], color);
      ctx.textAlign = "right";
      label(text, portX - 30, 225, color, 14);
      ctx.textAlign = "left";
    }
  }

  function paint(gap, phase, ship, captureFlash = 0) {
    drawSpace();
    const noseX = portX - gap;
    const color = phase === "held" ? holdColor
      : phase === "captured" && gap <= .5 ? captureColor : approachColor;
    if (phase !== "captured" || gap > .5) drawGuidance(noseX, phase, color);
    drawStation();
    drawShip(noseX, (phase === "departure" ? -.14 : -.09) * gap / openGap, ship);
    drawPortCue(phase, gap, captureFlash, color);
  }

  function show(next) {
    const identity = next ? JSON.stringify([next.phase, next.range, next.ship, next.caption]) : null;
    if (identity === scene) return;
    const previousScene = scene;
    scene = identity;
    cancelAnimationFrame(frame);
    if (!next) {
      distance = openGap;
      return;
    }

    const { phase, range, ship } = next;
    caption.textContent = next.caption;
    // A zero scripted range still needs visible clearance until capture is authorized.
    const target = phase === "captured" ? 0 : 20 + range * (openGap - 20);
    if (motion.matches || phase === "held" || (!previousScene && phase === "captured")) {
      distance = target;
      paint(distance, phase, ship);
      return;
    }

    const from = distance;
    const started = performance.now();
    const duration = phase === "departure" ? 1800 : 650;
    const capture = phase === "captured" && from > .5;
    paint(from, phase, ship);

    function advance(now) {
      const progress = Math.min(1, (now - started) / duration);
      const travel = capture ? Math.min(1, progress / .65) : progress;
      distance = from + (target - from) * (1 - (1 - travel) ** 3);
      const flash = capture && travel === 1 ? (1 - progress) / .35 : 0;
      paint(distance, phase, ship, flash);
      if (progress < 1) frame = requestAnimationFrame(advance);
    }
    frame = requestAnimationFrame(advance);
  }

  return {show};
}
