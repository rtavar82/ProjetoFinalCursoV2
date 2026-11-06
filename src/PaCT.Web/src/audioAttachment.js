export const audioAccept = '.mp3,.wav,.ogg,audio/mpeg,audio/wav,audio/ogg'

export function validateAudioFile(file) {
  if (!/\.(mp3|wav|ogg)$/i.test(file.name) || file.size <= 0 || file.size > 9_000_000)
    throw new Error('Escolhe um ficheiro de áudio MP3, WAV ou OGG até 9 MB.')
}
