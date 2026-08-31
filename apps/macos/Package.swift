// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "lernapp",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(
            name: "lernapp",
            path: "Sources/lernapp",
            swiftSettings: [.swiftLanguageMode(.v5)]
        )
    ]
)
