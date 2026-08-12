// Generates app icon assets from a single square source PNG (opaque background,
// solid-colour glyph). Run with: swift scripts/gen-icons.swift <source.png>
//
// Outputs into assets/images:
//   icon.png                      1024x1024 opaque, used for iOS + as the base icon
//   favicon.png                   48x48 opaque, web
//   android-icon-background.png   1024x1024 solid background colour
//   android-icon-foreground.png   1024x1024 glyph on transparency, inside the adaptive safe zone
//   android-icon-monochrome.png   1024x1024 white glyph on transparency, for Android 13 themed icons
//   splash-icon.png               1024x1024 white glyph on transparency, drawn over the splash background colour

import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

let args = CommandLine.arguments
guard args.count >= 2 else {
  FileHandle.standardError.write("usage: gen-icons.swift <source.png>\n".data(using: .utf8)!)
  exit(1)
}
let sourceURL = URL(fileURLWithPath: args[1])
let outDir = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
  .appendingPathComponent("assets/images")

guard
  let src = CGImageSourceCreateWithURL(sourceURL as CFURL, nil),
  let image = CGImageSourceCreateImageAtIndex(src, 0, nil)
else {
  FileHandle.standardError.write("could not read \(sourceURL.path)\n".data(using: .utf8)!)
  exit(1)
}

let w = image.width
let h = image.height
let space = CGColorSpaceCreateDeviceRGB()

// Read the source into a flat RGBA buffer.
var pixels = [UInt8](repeating: 0, count: w * h * 4)
pixels.withUnsafeMutableBytes { buf in
  let ctx = CGContext(
    data: buf.baseAddress, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
    space: space, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
  ctx.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
}

func rgb(_ x: Int, _ y: Int) -> (Double, Double, Double) {
  let i = (y * w + x) * 4
  return (Double(pixels[i]), Double(pixels[i + 1]), Double(pixels[i + 2]))
}

// The background is whatever fills the corners.
let bg = rgb(2, 2)
let bgHex = String(format: "#%02X%02X%02X", Int(bg.0), Int(bg.1), Int(bg.2))

// Coverage = how far a pixel is pushed from the background toward the glyph colour
// (white here). Doubles as an antialiased alpha mask.
func coverage(_ x: Int, _ y: Int) -> Double {
  let (r, g, b) = rgb(x, y)
  let channels = [(r, bg.0), (g, bg.1), (b, bg.2)]
  var total = 0.0
  var weight = 0.0
  for (v, base) in channels {
    let range = 255.0 - base
    guard range > 1 else { continue }
    total += min(max((v - base) / range, 0), 1) * range
    weight += range
  }
  return weight > 0 ? total / weight : 0
}

var mask = [UInt8](repeating: 0, count: w * h)
var minX = w, minY = h, maxX = -1, maxY = -1
for y in 0..<h {
  for x in 0..<w {
    let a = coverage(x, y)
    mask[y * w + x] = UInt8(min(max(a * 255, 0), 255).rounded())
    if a > 0.5 {
      minX = min(minX, x); maxX = max(maxX, x)
      minY = min(minY, y); maxY = max(maxY, y)
    }
  }
}
guard maxX >= minX else {
  FileHandle.standardError.write("no glyph found in source\n".data(using: .utf8)!)
  exit(1)
}

// White glyph carried entirely in the alpha channel.
var glyphRGBA = [UInt8](repeating: 0, count: w * h * 4)
for i in 0..<(w * h) {
  let a = mask[i]
  glyphRGBA[i * 4] = a
  glyphRGBA[i * 4 + 1] = a
  glyphRGBA[i * 4 + 2] = a
  glyphRGBA[i * 4 + 3] = a
}
let glyph = glyphRGBA.withUnsafeMutableBytes { buf -> CGImage in
  let ctx = CGContext(
    data: buf.baseAddress, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
    space: space, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
  return ctx.makeImage()!
}

func write(_ image: CGImage, to name: String) {
  let url = outDir.appendingPathComponent(name)
  let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)!
  CGImageDestinationAddImage(dest, image, nil)
  guard CGImageDestinationFinalize(dest) else {
    FileHandle.standardError.write("failed to write \(name)\n".data(using: .utf8)!)
    exit(1)
  }
  print("wrote \(name) — \(image.width)x\(image.height)")
}

func canvas(_ size: Int, opaque: Bool, _ draw: (CGContext) -> Void) -> CGImage {
  let info =
    opaque ? CGImageAlphaInfo.noneSkipLast.rawValue : CGImageAlphaInfo.premultipliedLast.rawValue
  let ctx = CGContext(
    data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0, space: space,
    bitmapInfo: info)!
  ctx.interpolationQuality = .high
  draw(ctx)
  return ctx.makeImage()!
}

let bgColor = CGColor(red: bg.0 / 255, green: bg.1 / 255, blue: bg.2 / 255, alpha: 1)

// iOS / base icon and favicon: the source art, flattened, at the required sizes.
for (name, size) in [("icon.png", 1024), ("favicon.png", 48)] {
  write(
    canvas(size, opaque: true) { ctx in
      ctx.setFillColor(bgColor)
      ctx.fill(CGRect(x: 0, y: 0, width: size, height: size))
      ctx.draw(image, in: CGRect(x: 0, y: 0, width: size, height: size))
    }, to: name)
}

write(
  canvas(1024, opaque: true) { ctx in
    ctx.setFillColor(bgColor)
    ctx.fill(CGRect(x: 0, y: 0, width: 1024, height: 1024))
  }, to: "android-icon-background.png")

// Adaptive/themed foregrounds: only the centre 66% of the canvas survives Android's
// masking, so refit the glyph into that safe zone. The circular mask is the tightest
// of the shapes Android applies, so fit the glyph's furthest pixel from its own centre
// inside that circle as well as fitting its bounding box in the square.
let boxW = maxX - minX + 1
let boxH = maxY - minY + 1
let safe = 1024.0 * 0.66
let boxCX = (Double(minX) + Double(maxX) + 1) / 2
let boxCY = (Double(minY) + Double(maxY) + 1) / 2
var radius = 0.0
for y in minY...maxY {
  for x in minX...maxX where mask[y * w + x] > 127 {
    radius = max(radius, hypot(Double(x) + 0.5 - boxCX, Double(y) + 0.5 - boxCY))
  }
}
let scale = min(safe / Double(max(boxW, boxH)), safe / 2 / radius)
let drawW = Double(w) * scale
let drawH = Double(h) * scale
// Bounding-box centre in flipped (CoreGraphics) coordinates.
let cx = boxCX * scale
let cy = (Double(h) - boxCY) * scale
let glyphRect = CGRect(x: 512 - cx, y: 512 - cy, width: drawW, height: drawH)

for name in ["android-icon-foreground.png", "android-icon-monochrome.png"] {
  write(canvas(1024, opaque: false) { $0.draw(glyph, in: glyphRect) }, to: name)
}

// Splash logo: nothing masks it, so fit the bounding box with only a little breathing room.
let splashScale = 1024.0 * 0.86 / Double(max(boxW, boxH))
write(
  canvas(1024, opaque: false) { ctx in
    ctx.draw(
      glyph,
      in: CGRect(
        x: 512 - boxCX * splashScale, y: 512 - (Double(h) - boxCY) * splashScale,
        width: Double(w) * splashScale, height: Double(h) * splashScale))
  }, to: "splash-icon.png")

print("background colour: \(bgHex)")
