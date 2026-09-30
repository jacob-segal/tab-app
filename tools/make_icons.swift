// Render icons/icon.svg-equivalent PNGs with CoreGraphics. Run: swift tools/make_icons.swift
import AppKit

func render(_ size: Int, to path: String) {
  let s = CGFloat(size), k = s / 512
  let cs = CGColorSpaceCreateDeviceRGB()
  guard let ctx = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0, space: cs,
                            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return }
  ctx.translateBy(x: 0, y: s); ctx.scaleBy(x: 1, y: -1)   // top-left origin like SVG
  // Full-bleed gradient (iOS rounds the corners itself)
  let colors = [CGColor(red: 0.545, green: 0.361, blue: 0.965, alpha: 1), CGColor(red: 0.925, green: 0.282, blue: 0.6, alpha: 1), CGColor(red: 0.961, green: 0.62, blue: 0.043, alpha: 1)] as CFArray
  let grad = CGGradient(colorsSpace: cs, colors: colors, locations: [0, 0.55, 1])!
  ctx.drawLinearGradient(grad, start: .zero, end: CGPoint(x: s, y: s), options: [])
  // Receipt
  let r = CGMutablePath()
  r.move(to: CGPoint(x: 150*k, y: 118*k))
  r.addLine(to: CGPoint(x: 362*k, y: 118*k))
  r.addQuadCurve(to: CGPoint(x: 380*k, y: 136*k), control: CGPoint(x: 380*k, y: 118*k))
  r.addLine(to: CGPoint(x: 380*k, y: 394*k))
  let teeth: [(CGFloat, CGFloat)] = [(350, 374), (319, 394), (288, 374), (256, 394), (225, 374), (194, 394), (164, 374), (132, 394)]
  for (x, y) in teeth { r.addLine(to: CGPoint(x: x*k, y: y*k)) }
  r.addLine(to: CGPoint(x: 132*k, y: 136*k))
  r.addQuadCurve(to: CGPoint(x: 150*k, y: 118*k), control: CGPoint(x: 132*k, y: 118*k))
  r.closeSubpath()
  ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 0.96)); ctx.addPath(r); ctx.fillPath()
  // T
  ctx.setStrokeColor(CGColor(red: 0.07, green: 0.07, blue: 0.106, alpha: 1)); ctx.setLineWidth(40*k); ctx.setLineCap(.round)
  ctx.move(to: CGPoint(x: 196*k, y: 184*k)); ctx.addLine(to: CGPoint(x: 316*k, y: 184*k))
  ctx.move(to: CGPoint(x: 256*k, y: 184*k)); ctx.addLine(to: CGPoint(x: 256*k, y: 334*k)); ctx.strokePath()
  guard let img = ctx.makeImage() else { return }
  let rep = NSBitmapImageRep(cgImage: img)
  try? rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: path))
}
for n in [180, 192, 512] { render(n, to: "icons/icon-\(n).png") }
print("icons written")
