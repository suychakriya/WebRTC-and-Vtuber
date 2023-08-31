'use strict'
import AgoraRTM from 'agora-rtm-sdk'

const APP_ID = '26cb8cde2a82494bad4fb6c16e3147d9'

const {
  live2d: { Live2DModel },
} = PIXI

const {
  Face,
  Vector: { lerp },
  Utils: { clamp },
} = Kalidokit

let client
let channel
let memberId

let token = null
let uid = String(Math.floor(Math.random() * 10000))

let models = [
  'models/hiyori/hiyori_pro_t10.model3.json',
  'models/mao/mao_pro_t02.model3.json',
  'models/natori/natori_pro_t06.model3.json',
]
// Keep track of the current model
let modelOrder = 0

let currentModel, facemesh

// HTML elements
const videoElement = document.querySelector('.input_video')
const user_video = document.getElementById('vid')
const user_1 = document.getElementById('user-1')
const leaveBtn = document.getElementById('leave-btn')
const user_2 = document.getElementById('user-2')
const cameraBtn = document.getElementById('camera-btn')
const micBtn = document.getElementById('mic-btn')
const modelBtn = document.getElementById('model-btn')
const videoGrid = document.getElementById('videos')
const refreshBtn = document.getElementById('refresh-btn')
const captionBtn = document.getElementById('caption-btn')
const transcriptText = document.getElementById('transcript')

let queryString = window.location.search
let urlParams = new URLSearchParams(queryString)
let roomId = urlParams.get('room')

if (!roomId) {
  window.location = 'lobby.html'
}

// Global State
let localStream
let remoteStream
let peerConnection
let dataChannel
let isStreamingAvatar = true
let isUserJoined = false
let isMicEnabled = false
let isCaptionEnabled = false
let requestCaption = false

// Caption
const SpeechRecognition = window.SpeechRecognition || webkitSpeechRecognition
let speechRecognition = new SpeechRecognition()

speechRecognition.continuous = true
speechRecognition.lang = 'en-US'

speechRecognition.onresult = (event) => {
  const result = event.results[event.resultIndex]

  if (result.isFinal) {
    // Send the transcribed caption over the DataChannel
    dataChannel.send(result[0].transcript)
  }
}

speechRecognition.addEventListener('error', (event) => {
  console.error(`Speech recognition error detected: ${event.error}`)
})

speechRecognition.addEventListener('end', () => {
  speechRecognition.start
  console.log('speech restart')
})

const servers = {
  iceServers: [
    {
      urls: 'stun:stun.relay.metered.ca:80',
    },
    {
      urls: 'turn:a.relay.metered.ca:80',
      username: '37d4d9104f144bc51214fa07',
      credential: 'Hcnb3tCBEN0gDBJd',
    },
    {
      urls: 'turn:a.relay.metered.ca:80?transport=tcp',
      username: '37d4d9104f144bc51214fa07',
      credential: 'Hcnb3tCBEN0gDBJd',
    },
    {
      urls: 'turn:a.relay.metered.ca:443',
      username: '37d4d9104f144bc51214fa07',
      credential: 'Hcnb3tCBEN0gDBJd',
    },
    {
      urls: 'turn:a.relay.metered.ca:443?transport=tcp',
      username: '37d4d9104f144bc51214fa07',
      credential: 'Hcnb3tCBEN0gDBJd',
    },
  ],
  iceCandidatePoolSize: 10,
}

const handleUserLeft = (MemberId) => {
  isUserJoined = false
  user_2.style.display = 'none'
  videoGrid.style.gridTemplateColumns = '1fr'
  videoGrid.style.gap = '0'
  videoGrid.style.padding = '0'
  micBtn.style.display = 'none'
  refreshBtn.style.display = 'none'
  captionBtn.style.display = 'none'
  memberId = ''
}

const handleMessageFromPeer = async (message, MemberId) => {
  message = JSON.parse(message.text)

  if (message.type === 'offer') {
    createAnswer(MemberId, message.offer)
  }

  if (message.type === 'caption') {
    if ('webkitSpeechRecognition' in window) {
      if (message.msg === 'start caption') {
        requestCaption = true
        if (isMicEnabled) {
          speechRecognition.start()
        }
      } else if (message.msg === 'stop caption') {
        requestCaption = false
        speechRecognition.stop()
      }
      console.log(message.msg)
    }
  }

  if (message.type === 'answer') {
    addAnswer(message.answer, message)
  }

  if (message.type === 'candidate') {
    if (peerConnection) {
      peerConnection.addIceCandidate(message.candidate)
    }
  }
}

const handleUserJoined = async (MemberId) => {
  console.log('A new user joined the channel:', MemberId)
  createOffer(MemberId)
}

const changeStream = async () => {
  isStreamingAvatar = !isStreamingAvatar
  if (isUserJoined) {
    localStream.getTracks().forEach((track) => track.stop())
    // Remove the old tracks from the peer connection
    peerConnection.getSenders().forEach((sender) => {
      peerConnection.removeTrack(sender)
    })
    // create new offer
    createOffer(memberId)
  }
}

let handleDataChannelOpen = function (event) {
  console.log('dataChannel.OnOpen', event)
}

let handleDataChannelMessageReceived = function (event) {
  // console.log("dataChannel.OnMessage:", event.data)
  document.getElementById('message').innerHTML = event.data
}

let handleDataChannelError = function (error) {
  console.log('dataChannel.OnError:', error)
}

let handleDataChannelClose = function (event) {
  console.log('dataChannel.OnClose', event)
}

let handleChannelCallback = function (event) {
  dataChannel = event.channel
  dataChannel.onopen = handleDataChannelOpen
  dataChannel.onmessage = handleDataChannelMessageReceived
  dataChannel.onerror = handleDataChannelError
  dataChannel.onclose = handleDataChannelClose
}

const createPeerConnection = async (MemberId) => {
  memberId = MemberId
  micBtn.style.display = 'block'
  refreshBtn.style.display = 'block'
  captionBtn.style.display = 'block'
  isUserJoined = true
  peerConnection = new RTCPeerConnection(servers)

  peerConnection.ondatachannel = handleChannelCallback

  dataChannel = peerConnection.createDataChannel('caption', {})

  dataChannel.onopen = handleDataChannelOpen
  dataChannel.onmessage = handleDataChannelMessageReceived
  dataChannel.onerror = handleDataChannelError
  dataChannel.onclose = handleDataChannelClose

  if (isStreamingAvatar) {
    localStream = document.querySelector('canvas').captureStream()
    let audioStream = await navigator.mediaDevices.getUserMedia({
      video: false,
      audio: true,
    })
    localStream.addTrack((await audioStream).getTracks()[0])
    localStream.getTracks().forEach((track) => {
      peerConnection.addTrack(track, localStream)
    })
  } else {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    })
    localStream.getTracks().forEach((track) => {
      peerConnection.addTrack(track, localStream)
    })
  }

  if (!isMicEnabled) {
    toggleMic()
  }

  remoteStream = new MediaStream()
  user_2.srcObject = remoteStream

  user_2.style.display = 'block'
  videoGrid.style.gridTemplateColumns = '1fr 1fr'
  videoGrid.style.gap = '1.5rem'
  videoGrid.style.padding = '1.5rem'

  // Pull tracks from remote stream, add to video stream
  peerConnection.ontrack = (event) => {
    event.streams[0].getTracks().forEach((track) => {
      remoteStream.addTrack(track)
    })
  }

  peerConnection.onicecandidate = async (event) => {
    if (event.candidate) {
      client.sendMessageToPeer(
        {
          text: JSON.stringify({
            type: 'candidate',
            candidate: event.candidate,
          }),
        },
        MemberId
      )
    }
  }
}

const createOffer = async (MemberId) => {
  await createPeerConnection(MemberId)

  let offer = await peerConnection.createOffer()
  await peerConnection.setLocalDescription(offer)

  client.sendMessageToPeer(
    { text: JSON.stringify({ type: 'offer', offer: offer }) },
    MemberId
  )
}

const createAnswer = async (MemberId, offer) => {
  await createPeerConnection(MemberId)

  await peerConnection.setRemoteDescription(offer)

  let answer = await peerConnection.createAnswer()
  await peerConnection.setLocalDescription(answer)

  client.sendMessageToPeer(
    { text: JSON.stringify({ type: 'answer', answer: answer }) },
    MemberId
  )
}

const addAnswer = async (answer, message) => {
  await peerConnection
    .setRemoteDescription(answer)
    .then(() => {
      if (peerConnection.remoteDescription) {
        peerConnection.addIceCandidate(message.candidate)
      }
    })
    .catch((e) => {
      console.error(e)
    })
}

const leaveChannel = async () => {
  await channel.leave()
  await client.logout()
}

const onResults = (results) => {
  animateLive2DModel(results.multiFaceLandmarks[0])
}

const animateLive2DModel = (points) => {
  if (!currentModel || !points) return

  let riggedFace

  if (points) {
    // use kalidokit face solver
    riggedFace = Face.solve(points, {
      runtime: 'mediapipe',
      video: videoElement,
    })
    rigFace(riggedFace, 0.5)
  }
}

const rigFace = (result, lerpAmount = 0.7) => {
  if (!currentModel || !result) return
  const updateFn = currentModel.internalModel.motionManager.update
  const coreModel = currentModel.internalModel.coreModel

  currentModel.internalModel.motionManager.update = (...args) => {
    // disable default blink animation
    currentModel.internalModel.eyeBlink = undefined

    coreModel.setParameterValueById(
      'ParamEyeBallX',
      lerp(
        result.pupil.x,
        coreModel.getParameterValueById('ParamEyeBallX'),
        lerpAmount
      )
    )
    coreModel.setParameterValueById(
      'ParamEyeBallY',
      lerp(
        result.pupil.y,
        coreModel.getParameterValueById('ParamEyeBallY'),
        lerpAmount
      )
    )

    // X and Y axis rotations are swapped for Live2D parameters
    // because it is a 2D system and KalidoKit is a 3D system
    coreModel.setParameterValueById(
      'ParamAngleX',
      lerp(
        result.head.degrees.y,
        coreModel.getParameterValueById('ParamAngleX'),
        lerpAmount
      )
    )
    coreModel.setParameterValueById(
      'ParamAngleY',
      lerp(
        result.head.degrees.x,
        coreModel.getParameterValueById('ParamAngleY'),
        lerpAmount
      )
    )
    coreModel.setParameterValueById(
      'ParamAngleZ',
      lerp(
        result.head.degrees.z,
        coreModel.getParameterValueById('ParamAngleZ'),
        lerpAmount
      )
    )

    // update body params for models without head/body param sync
    const dampener = 0.3
    coreModel.setParameterValueById(
      'ParamBodyAngleX',
      lerp(
        result.head.degrees.y * dampener,
        coreModel.getParameterValueById('ParamBodyAngleX'),
        lerpAmount
      )
    )
    coreModel.setParameterValueById(
      'ParamBodyAngleY',
      lerp(
        result.head.degrees.x * dampener,
        coreModel.getParameterValueById('ParamBodyAngleY'),
        lerpAmount
      )
    )
    coreModel.setParameterValueById(
      'ParamBodyAngleZ',
      lerp(
        result.head.degrees.z * dampener,
        coreModel.getParameterValueById('ParamBodyAngleZ'),
        lerpAmount
      )
    )

    // Simple example without winking.
    // Interpolate based on old blendshape, then stabilize blink with `Kalidokit` helper function.
    let stabilizedEyes = Face.stabilizeBlink(
      {
        l: lerp(
          result.eye.l,
          coreModel.getParameterValueById('ParamEyeLOpen'),
          0.7
        ),
        r: lerp(
          result.eye.r,
          coreModel.getParameterValueById('ParamEyeROpen'),
          0.7
        ),
      },
      result.head.y
    )
    // eye blink
    coreModel.setParameterValueById('ParamEyeLOpen', stabilizedEyes.l)
    coreModel.setParameterValueById('ParamEyeROpen', stabilizedEyes.r)

    // mouth
    coreModel.setParameterValueById(
      'ParamMouthOpenY',
      lerp(
        result.mouth.y,
        coreModel.getParameterValueById('ParamMouthOpenY'),
        0.3
      )
    )
    // Adding 0.3 to ParamMouthForm to make default more of a "smile"
    coreModel.setParameterValueById(
      'ParamMouthForm',
      0.4 +
        lerp(
          result.mouth.x,
          coreModel.getParameterValueById('ParamMouthForm'),
          0.3
        )
    )
  }
}

// start camera using mediapipe camera utils
const startCamera = () => {
  const camera = new Camera(videoElement, {
    onFrame: async () => {
      await facemesh.send({ image: videoElement })
    },
  })
  camera.start()
}

const toggleMic = async () => {
  let audioTrack = localStream
    .getTracks()
    .find((track) => track.kind === 'audio')

  if (audioTrack.enabled) {
    audioTrack.enabled = false
    isMicEnabled = false
    speechRecognition.stop()
    document.getElementById('mic-btn').style.backgroundColor =
      'rgb(255, 80, 80)'
  } else {
    audioTrack.enabled = true
    isMicEnabled = true
    document.getElementById('mic-btn').style.backgroundColor =
      'rgb(179, 102, 249, .9)'
    if (requestCaption) {
      speechRecognition.start()
    }
  }
}

const loadModel = async (modelOrder) => {
  let modelScale
  let modelAnchor

  const app = new PIXI.Application({
    view: user_1,
    autoStart: true,
    transparent: true,
    backgroundAlpha: 0,
  })

  let modelUrl = models[modelOrder]
  // Unload the previous model if it exists
  if (currentModel) {
    await currentModel.destroy()
    currentModel = null
  }

  // load live2d model
  currentModel = await Live2DModel.from(modelUrl, {
    autoInteract: false,
  })

  if (modelOrder == 0) {
    modelScale = 0.55
    modelAnchor = [0.5, 0.21]
  } else if (modelOrder == 1) {
    modelScale = 0.22
    modelAnchor = [0.5, 0.32]
  } else if (modelOrder == 2) {
    modelScale = 0.27
    modelAnchor = [0.5, 0.22]
  }

  currentModel.scale.set(modelScale)
  currentModel.anchor.set(modelAnchor[0], modelAnchor[1])

  currentModel.x = user_1.width / 2
  currentModel.y = user_1.height / 2

  // add live2d model to stage
  app.stage.addChild(currentModel)
}

const changeModel = async () => {
  // Increase the current model index by one
  modelOrder = (modelOrder + 1) % models.length
  loadModel(modelOrder)
}

const main = async () => {
  client = await AgoraRTM.createInstance(APP_ID)
  await client.login({ uid, token })

  channel = client.createChannel(roomId)
  await channel.join()

  channel.on('MemberJoined', handleUserJoined)
  channel.on('MemberLeft', handleUserLeft)

  client.on('MessageFromPeer', handleMessageFromPeer)

  await loadModel(modelOrder)

  // create media pipe facemesh instance
  facemesh = new FaceMesh({
    locateFile: (file) => {
      return `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
    },
  })

  // set facemesh config
  facemesh.setOptions({
    maxNumFaces: 1,
    refineLandmarks: true,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5,
  })

  // pass facemesh callback function
  facemesh.onResults(onResults)

  startCamera()
}

captionBtn.addEventListener('click', () => {
  if (!isCaptionEnabled) {
    isCaptionEnabled = true
    client.sendMessageToPeer(
      { text: JSON.stringify({ type: 'caption', msg: 'start caption' }) },
      memberId
    )
    transcriptText.style.display = 'flex'
  } else {
    isCaptionEnabled = false
    client.sendMessageToPeer(
      { text: JSON.stringify({ type: 'caption', msg: 'stop caption' }) },
      memberId
    )
    transcriptText.style.display = 'none'
  }
})

modelBtn.addEventListener('click', changeModel)

micBtn.addEventListener('click', toggleMic)

leaveBtn.addEventListener('click', () => {
  leaveChannel()
  window.location = 'lobby.html'
})

cameraBtn.addEventListener('click', async () => {
  if (user_video.style.display === 'none' || user_video.style.display === '') {
    user_video.style.display = 'block'
    user_1.style.display = 'none'
    modelBtn.style.display = 'none'
  } else {
    user_video.style.display = 'none'
    user_1.style.display = 'block'
    modelBtn.style.display = 'block'
  }
  await changeStream()
})

refreshBtn.addEventListener('click', () => {
  createOffer(memberId)
})

window.addEventListener('beforeunload', leaveChannel)

window.addEventListener('DOMContentLoaded', () => {
  main()
})

const updateGrid = function () {
  if (user_2.style.display === 'block') {
    if (window.innerWidth <= 768) {
      videoGrid.style.gridTemplateColumns = '1fr'
      videoGrid.style.gridAutoRows = '50vh'
      user_2.style.gridRow = '1'
    } else {
      videoGrid.style.gridTemplateColumns = '1fr 1fr'
      videoGrid.style.gap = '1.5rem'
      videoGrid.style.padding = '1.5rem'
      videoGrid.style.gridAutoRows = 'auto'
      user_2.style.gridRow = ''
    }
  }
}

window.addEventListener('resize', updateGrid)
