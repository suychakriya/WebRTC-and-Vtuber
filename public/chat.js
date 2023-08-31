'use strict'

const {
  live2d: { Live2DModel },
} = PIXI

let currentModel

let models = [
  'models/hiyori/hiyori_pro_t10.model3.json',
  'models/mao/mao_pro_t02.model3.json',
  'models/natori/natori_pro_t06.model3.json',
]

let modelOrder = 0

let live2d_avatar = document.getElementById('live2d-avatar')
let userInput = document.getElementById('user-input')
let home_icon = document.getElementById('home-icon')
let sendBtn = document.getElementById('send-btn')
let voiceIcon = document.getElementById('voice-btn')
let stopBtn = document.getElementById('stop-btn')
let statusElem = document.querySelector('#status')

const speechRecognition = new webkitSpeechRecognition()
const speechSynthesis = window.speechSynthesis

let isListening = false
let isTalking = false
let messages = [{ role: 'system', content: 'You are a helpful assistant.' }]

const main = async () => {
  await loadModel(modelOrder)
}

function adjustTextareaHeight() {
  var textarea = document.getElementById('user-input')
  textarea.style.height = 'auto'
  textarea.style.height = textarea.scrollHeight + 'px'
}

function resetTextareaHeight() {
  var textarea = document.getElementById('user-input')
  textarea.style.height = 'auto'
}

const loadModel = async (modelOrder) => {
  let modelScale
  let modelAnchor

  const app = new PIXI.Application({
    view: live2d_avatar,
    autoStart: true,
    transparent: true,
    backgroundAlpha: 0,
  })

  let modelUrl = models[modelOrder]

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

  currentModel.x = live2d_avatar.width / 2
  currentModel.y = live2d_avatar.height / 2

  // add live2d model to stage
  app.stage.addChild(currentModel)
}

const startListening = () => {
  isListening = true
  voiceIcon.classList.add('listening')
  speechRecognition.start()
}

const stopListening = () => {
  isListening = false
  voiceIcon.classList.remove('listening')
  speechRecognition.stop()
}

const showStatus = (message) => {
  statusElem.innerHTML = message
  statusElem.style.display = 'block'
}

const hideStatus = () => {
  statusElem.innerHTML = ''
  statusElem.style.display = 'none'
}

const speechRecogn = () => {
  if ('webkitSpeechRecognition' in window) {
    let final_transcript = ''

    speechRecognition.continuous = true
    speechRecognition.interimResults = false
    speechRecognition.lang = 'en-US' // Set English as the default language

    speechRecognition.onstart = () => {
      showStatus('listening')
    }

    speechRecognition.onerror = () => {
      hideStatus()
      console.log('Speech Recognition Error')
    }

    speechRecognition.onend = () => {
      hideStatus()
      console.log('Speech Recognition Ended')
    }

    speechRecognition.onresult = (event) => {
      final_transcript = event.results[event.results.length - 1][0].transcript
      userInput.value += final_transcript
    }

    if (isListening) {
      stopListening()
      hideStatus()
    } else {
      startListening()
    }
  } else {
    console.log('Speech Recognition Not Available')
  }
}

document.addEventListener('DOMContentLoaded', function () {
  var userInput = document.getElementById('user-input')
  userInput.addEventListener('input', adjustTextareaHeight)
  main()
})

home_icon.addEventListener('click', () => {
  window.location = 'lobby.html'
})

const handleInput = async () => {
  const text = userInput.value

  userInput.value = ''
  resetTextareaHeight()

  stopListening()

  messages.push({
    role: 'user',
    content: text,
  })

  showStatus('Processing')

  const url = 'https://chatgpt-t3wktjp4vq-uc.a.run.app'

  sendBtn.style.display = 'none'
  voiceIcon.style.display = 'none'

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ messages }),
    })

    // Assuming the API response is JSON
    const responseData = await response.json()

    messages.push(responseData.message)

    // Get the content from the response
    const apiResponseText = responseData.message.content

    hideStatus()

    await speakText(apiResponseText)
  } catch (error) {
    sendBtn.style.display = 'block'
    voiceIcon.style.display = 'block'
    hideStatus()
    console.log(error)
  } finally {
    sendBtn.style.display = 'block'
    voiceIcon.style.display = 'block'
  }
}

sendBtn.addEventListener('click', () => {
  handleInput()
})

userInput.onkeydown = async (event) => {
  const keyCode = event.keyCode
  if (keyCode === 13) {
    event.preventDefault()
    if (statusElem.innerHTML !== 'Processing' && !isTalking) {
      handleInput()
    }
  }
}

voiceIcon.addEventListener('click', () => {
  speechRecogn()
})

let animationFrameId = null

const startMouthAnimation = () => {
  const mouthOpenYParam = 'ParamMouthOpenY'
  const mouthFormParam = 'ParamMouthForm'

  let time = 0

  const updateMouthAnimation = () => {
    const coreModel = currentModel.internalModel.coreModel

    // Calculate the mouth animation values based on time
    const mouthOpenY = Math.sin(time) * 0.9
    const mouthForm = 0.7 + Math.sin(time * 0.5) * 0.1

    // Set the parameter values for mouth animation
    coreModel.setParameterValueById(mouthOpenYParam, mouthOpenY)
    coreModel.setParameterValueById(mouthFormParam, mouthForm)

    // Increment the time for the next frame
    time += 0.2 // Adjust the speed as needed

    // Request the next animation frame
    animationFrameId = requestAnimationFrame(updateMouthAnimation)
  }

  // Start the mouth animation loop
  updateMouthAnimation()
}

const stopMouthAnimation = () => {
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId)
    animationFrameId = null
  }

  const coreModel = currentModel.internalModel.coreModel

  // Reset the mouth animation parameter values to their default state
  coreModel.setParameterValueById('ParamMouthOpenY', 0)
  coreModel.setParameterValueById('ParamMouthForm', 0)
}

let stopFlag = false
let utterance = null

const speakText = async (text) => {
  isTalking = true
  stopFlag = false

  stopBtn.style.display = 'block'

  utterance = new SpeechSynthesisUtterance()
  utterance.lang = 'en-GB'
  utterance.voice = speechSynthesis
    .getVoices()
    .find((voice) => voice.name === 'Google UK English Female')

  utterance.rate = 0.9 // Normal speech rate
  utterance.pitch = 1.3 // Normal pitch

  const sentences = text.match(/[^.!?]+[.!?]/g)

  for (const sentence of sentences) {
    if (stopFlag) {
      break
    }

    utterance.text = sentence.trim()

    // Start the mouth animation before speaking each sentence
    startMouthAnimation()

    await new Promise((resolve, reject) => {
      utterance.onend = () => {
        // Stop the mouth animation after speaking each sentence
        stopMouthAnimation()
        resolve()
      }
      utterance.onerror = (event) => {
        // Stop the mouth animation on speech synthesis error
        stopMouthAnimation()
        reject(event.error)
      }
      speechSynthesis.speak(utterance)
    })
  }

  isTalking = false
  stopBtn.style.display = 'none'
}

function stopSpeakText() {
  isTalking = false
  stopFlag = true
  if (utterance) {
    speechSynthesis.cancel()
    utterance = null
  }
}

// Somewhere else in your code, call the stop function to stop the speaking

stopBtn.addEventListener('click', () => {
  stopBtn.style.display = 'none'
  stopMouthAnimation()
  stopSpeakText()
})
