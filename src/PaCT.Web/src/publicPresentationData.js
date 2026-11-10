import { apiRequest } from './identityApi'
import { agendaMoney } from './agendaTime'

function isPresentationImage(path) {
  return typeof path === 'string' && (/^\/presentation\/[a-z-]+\.png$/.test(path)
    || /^\/api\/public\/presentation\/images\/(?:portrait|gallery-[1-9]\d*|signature)\/[a-f0-9]{64}\.(?:png|jpg)$/.test(path))
}

export async function readPublicPresentation(signal) {
  const data = await apiRequest('public/presentation', undefined, { signal })
  const person = data?.therapist
  const payment = data?.paymentInformation
  if (!person || !['name', 'role', 'heading', 'introduction', 'summary', 'approach', 'closing'].every(key => typeof person[key] === 'string')
    || !Array.isArray(person.sections) || !Array.isArray(person.gallery)
    || ![person.heroImage, person.signatureImage, ...person.gallery.map(p => p.image)].every(isPresentationImage)
    || person.sections.some(s => typeof s.heading !== 'string' || typeof s.text !== 'string')
    || person.gallery.some(p => typeof p.alt !== 'string' || typeof p.caption !== 'string')
    || !/^(https:\/\/wa\.me\/\d+)?$/.test(person.whatsapp) || !/^(tel:\+\d+)?$/.test(person.telephone) || !/^(https:\/\/www\.instagram\.com\/[a-zA-Z0-9_.]+\/)?$/.test(person.instagram)
    || !Array.isArray(data.experiences) || data.experiences.some(title => typeof title !== 'string')
    || data.experiencePresentations != null && (!Array.isArray(data.experiencePresentations) || data.experiencePresentations.some(item => !['key', 'title', 'introduction', 'description', 'durationText', 'priceText'].every(key => typeof item[key] === 'string')
      || item.isFree != null && typeof item.isFree !== 'boolean'
      || item.serviceTitles != null && (!Array.isArray(item.serviceTitles) || item.serviceTitles.some(title => typeof title !== 'string'))
      || !['Group', 'Retreat'].includes(item.serviceKind) || !Array.isArray(item.conditions) || item.conditions.some(section => typeof section.title !== 'string' || !Array.isArray(section.paragraphs) || section.paragraphs.some(text => typeof text !== 'string'))))
    || !Array.isArray(data.services) || data.services.some(s => typeof s.id !== 'string' || typeof s.title !== 'string'
      || s.packOffer != null && !['description', 'durationText', 'paymentText', 'usageText'].every(key => typeof s.packOffer[key] === 'string')
      || s.presentation != null && (typeof s.presentation.description !== 'string' || typeof s.presentation.introduction !== 'string'
        || typeof s.presentation.recommendations !== 'string' || s.presentation.packSessions != null && (!Number.isInteger(s.presentation.packSessions) || s.presentation.packSessions < 2)) || !Array.isArray(s.options)
      || s.options.some(o => !['Remote', 'InPerson'].includes(o.modality) || typeof o.publicLocation !== 'string' || typeof o.locationDescription !== 'string' || !Number.isInteger(o.durationMinutes)
        || !['Prepayment', 'Postpayment', 'Contribution', 'Free'].includes(o.paymentMode) || (o.referencePrice !== null && !Number.isFinite(o.referencePrice)) || o.packTotal != null && (!Number.isFinite(o.packTotal) || Math.round(o.packTotal * 100) !== Math.round(o.referencePrice * s.presentation?.packSessions * 100))))
    || !payment || !/^(PT\d{23})?$/.test(payment.iban) || !/^([A-Z0-9]{8}([A-Z0-9]{3})?)?$/.test(payment.bic) || !/^(\d{3} \d{3} \d{3})?$/.test(payment.mbWay)
    || !['transferNote', 'mbWayNote', 'cashNote', 'advanceCashNote', 'contributionText', 'contributionTiming', 'contactNote'].every(key => typeof payment[key] === 'string')
    || !payment.prepayment || !['termsVersion', 'terms', 'waitNote', 'cancellation'].every(key => typeof payment.prepayment[key] === 'string')
    || !Array.isArray(payment.prepayment.payments) || payment.prepayment.payments.some(text => typeof text !== 'string')
    || !Array.isArray(payment.prepayment.cancellations) || payment.prepayment.cancellations.some(text => typeof text !== 'string')
    || data.packPolicy?.validityMonths !== 12) throw new Error('Não foi possível ler a apresentação. Tenta novamente.')
  return data
}

const individualPreviews = [
  {
    title: 'Sessão Individual de Constelação Familiar',
    previous: 'Olhar para o que se repete.',
    introduction: 'Explora dinâmicas familiares, relações e padrões que se repetem, num espaço de escuta.',
  },
  {
    title: 'Sessão de Reiki & Alinhamento Energético',
    previous: 'Um momento de pausa e cuidado.',
    introduction: 'Uma sessão dedicada ao relaxamento, à escuta e ao equilíbrio pessoal.',
  },
  {
    title: 'Consultas «Sentir Além do Olhar»',
    previous: 'Um caminho, lado a lado.',
    introduction: 'Acompanhamento individual de desenvolvimento pessoal, adaptado ao teu momento.',
    icon: 'sparkles',
  },
]
const experiencePreviews = {
  'constelacao-grupo': {
    previous: 'Um olhar partilhado, em grupo.',
    introduction: 'Explora dinâmicas familiares num encontro de escuta e partilha em grupo.',
  },
  'oficina-dons-cura': {
    previous: 'Um encontro de partilha e experiências.',
    introduction: 'Um encontro para partilhar dons, talentos e experiências. O tema é apresentado em cada edição.',
    icon: 'sparkles',
  },
  retiro: {
    previous: 'Mais tempo para parar e estar presente.',
    introduction: 'Um ou vários dias de práticas e atividades. Uma única inscrição abrange o programa completo.',
  },
}

export const publicGroupRegistration = 'Com conta registada, a inscrição fica confirmada se existir vaga. Sem conta, o pedido aguarda confirmação da terapeuta.'

export function publicCatalogueIntroductions(home) {
  const individual = home?.servicesIntroduction
  const experiences = home?.experiencesIntroduction
  return {
    individual: !individual || individual === 'Sessões individuais, presenciais ou online, para diferentes momentos do teu caminho.'
      ? 'Encontra o acompanhamento que faz sentido para ti.' : individual,
    experiences: !experiences || experiences === 'Grupos, oficinas e retiros decorrem em datas próprias, com vagas limitadas.'
      ? 'Experiências em grupo, com datas próprias e vagas limitadas.' : experiences,
  }
}

export function publicIndividualPreviews(services) {
  const titleKey = title => title.trim().replace(/[“”«»]/g, '"').toLocaleLowerCase('pt-PT')
  return services.map(service => {
    const key = titleKey(service.title)
    const index = individualPreviews.findIndex(item => titleKey(item.title) === key)
    if (index === -1) return { service, order: individualPreviews.length }
    const { title, previous, introduction, icon } = individualPreviews[index]
    return {
      service, order: index,
      preview: { title, icon, introduction: !service.presentation || service.presentation.introduction === previous ? introduction : undefined },
    }
  }).sort((a, b) => a.order - b.order)
}

export function publicExperiencePreview(experience) {
  const copy = Object.hasOwn(experiencePreviews, experience.key) ? experiencePreviews[experience.key] : undefined
  if (!copy) return undefined
  return { icon: copy.icon, introduction: experience.introduction === copy.previous ? copy.introduction : undefined }
}

export const publicMode = option => option.modality === 'Remote' ? 'Online' : 'Presencial'
export const publicMoney = option => option.paymentMode === 'Free' ? 'Gratuito' : option.paymentMode === 'Contribution' ? 'Contribuição livre e consciente' : option.referencePrice == null ? 'Valor por definir' : agendaMoney(option.referencePrice)
export function publicLocations(options) {
  return [...new Map(options.map(option => [JSON.stringify([option.modality, option.publicLocation]), {
    key: JSON.stringify([option.modality, option.publicLocation]), name: option.modality === 'Remote' ? 'Online' : option.publicLocation,
    icon: option.modality === 'Remote' ? 'video' : 'pin', description: option.locationDescription
  }])).values()]
}

export const clientHomeHashes = { PublicHome: '#inicio', PublicTestimonials: '#testemunhos' }

export function clientHomePage(hash = window.location.hash) {
  return Object.keys(clientHomeHashes).find(page => clientHomeHashes[page] === hash)
}

export function publicRoute() {
  const [path, query] = window.location.hash.slice(1).split('?')
  const service = new URLSearchParams(query).get('servico')
  return { stage: path === 'entrar' ? 'SignIn' : path === 'terapeuta' ? 'PublicTherapist' : path === 'testemunhos' ? 'PublicTestimonials' : path === 'partilhas' ? 'PublicSharing' : path === 'agenda' ? 'PublicAgenda' : path ? 'PublicHome' : 'PublicOpening',
    serviceId: service && /^[0-9a-f-]{36}$/i.test(service) ? service : '' }
}
