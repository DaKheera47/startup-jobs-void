import { fetch as wfetch } from 'wreq-js'

const URL = 'https://startup.jobs/creative-director-mindalter-7794503'

// plain node fetch — will 403
console.log('--- plain fetch ---')
const plain = await fetch(URL)
console.log('status:', plain.status, plain.statusText)

// wreq-js with chrome impersonation — will 200
console.log('\n--- wreq-js (chrome_142) ---')
const smart = await wfetch(URL, { browser: 'chrome_142', os: 'macos' })
console.log('status:', smart.status, smart.statusText)
