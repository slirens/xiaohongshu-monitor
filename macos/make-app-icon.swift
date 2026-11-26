import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

let source = URL(fileURLWithPath: CommandLine.arguments[1])
let output = URL(fileURLWithPath: CommandLine.arguments[2], isDirectory: true)
try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
guard let original = CGImageSourceCreateWithURL(source as CFURL, nil),
      let logo = CGImageSourceCreateImageAtIndex(original, 0, nil) else {
    throw CocoaError(.fileReadCorruptFile)
}

for size in [16, 32, 128, 256, 512] {
    for scale in [1, 2] {
        let pixels = size * scale
        let outputFile = output.appendingPathComponent("icon_\(size)x\(size)\(scale == 2 ? "@2x" : "").png")
        guard let painter = CGContext(data: nil, width: pixels, height: pixels, bitsPerComponent: 8,
                                      bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(),
                                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else {
            throw CocoaError(.fileWriteUnknown)
        }
        painter.clear(CGRect(x: 0, y: 0, width: CGFloat(pixels), height: CGFloat(pixels)))
        painter.interpolationQuality = .high
        // Keep the supplied corner shape and center the mark within the macOS icon canvas.
        let artwork = (CGFloat(pixels) * (824.0 / 1024.0)).rounded()
        let inset = (CGFloat(pixels) - artwork) / 2
        painter.draw(logo, in: CGRect(x: inset, y: inset, width: artwork, height: artwork))
        guard let image = painter.makeImage(),
              let destination = CGImageDestinationCreateWithURL(outputFile as CFURL, UTType.png.identifier as CFString, 1, nil) else {
            throw CocoaError(.fileWriteUnknown)
        }
        CGImageDestinationAddImage(destination, image, nil)
        guard CGImageDestinationFinalize(destination) else { throw CocoaError(.fileWriteUnknown) }
    }
}
