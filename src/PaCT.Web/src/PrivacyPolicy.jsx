import Heading from './Heading'

export const privacyTitle = 'Privacidade e proteção de dados'

export default function PrivacyPolicy({ content }) {
  return <article aria-label={privacyTitle}>
    <p><strong>Responsável pelo tratamento</strong><br />{content.controllerName}</p>
    <p><strong>Contacto de privacidade</strong><br />
      {content.contactEmail ? <a href={'mailto:' + content.contactEmail}>{content.contactEmail}</a> : 'Por indicar'}</p>
    {content.text.split(/\r?\n/).filter(line => line.trim()).map((line, index) => line.startsWith('# ')
      ? <Heading key={index} level={3}>{line.slice(2)}</Heading> : <p key={index}>{line}</p>)}
    <p><a href="https://www.cnpd.pt/cidadaos/direitos/">Consultar os teus direitos na CNPD</a></p>
  </article>
}
