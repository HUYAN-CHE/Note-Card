import Foundation
import Speech

let args = CommandLine.arguments
guard args.count >= 2 else {
    fputs("usage: TranscribeSegment <audio-file>\n", stderr)
    exit(64)
}

let url = URL(fileURLWithPath: args[1])
guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "zh_CN")) else {
    fputs("No zh_CN speech recognizer available\n", stderr)
    exit(1)
}

let authSemaphore = DispatchSemaphore(value: 0)
var authStatus = SFSpeechRecognizerAuthorizationStatus.notDetermined
SFSpeechRecognizer.requestAuthorization { status in
    authStatus = status
    authSemaphore.signal()
}
authSemaphore.wait()

print("auth=\(authStatus.rawValue) available=\(recognizer.isAvailable)")
guard authStatus == .authorized else {
    exit(2)
}

let request = SFSpeechURLRecognitionRequest(url: url)
request.shouldReportPartialResults = true
if #available(macOS 10.15, *) {
    request.requiresOnDeviceRecognition = false
}

let semaphore = DispatchSemaphore(value: 0)
var finalText = ""
var finalError: Error?

let task = recognizer.recognitionTask(with: request) { result, error in
    if let result {
        finalText = result.bestTranscription.formattedString
        if result.isFinal {
            semaphore.signal()
        }
    }
    if let error {
        finalError = error
        semaphore.signal()
    }
}

_ = semaphore.wait(timeout: .now() + 180)
task.cancel()

if let finalError {
    print("error=\(finalError.localizedDescription)")
}
print("TEXT_START")
print(finalText)
print("TEXT_END")
