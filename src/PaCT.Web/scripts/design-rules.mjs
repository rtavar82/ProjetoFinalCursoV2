import postcss from 'postcss'

const typeProperties = new Set(['font', 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing'])
const semanticText = /(?:^|[\s>+~,:(])(?:h[1-6]|label|legend|input|select|textarea|button)(?=[\s>+~,.#[:)]|$)/

export function inspectDesignCss(source, file, tokens = new Set()) {
  const issues = [], tree = postcss.parse(source, { from: file })
  const issue = (node, message) => issues.push(`${file}:${node.source.start.line}: ${message}`)
  tree.walkDecls(decl => {
    if (/^--(?:theme-|space-|page-gutter$|page-width$|reading-width$|control-height$|field-height$|control-radius$|surface-inverse-text$)/.test(decl.prop) && file !== 'design-tokens.css') {
      issue(decl, 'Definir a paleta e a escala de espaçamento e controlos apenas em design-tokens.css.')
    }
    if (/^--(?:font-size-|body-font$|heading-font$|code-font$)/.test(decl.prop) && file !== 'design-tokens.css') issue(decl, 'Definir tokens tipográficos apenas em design-tokens.css.')
    if (decl.prop === 'font-family' && file !== 'typography.css') issue(decl, 'A família de letra pertence à base typography.css, não à página/componente.')
    if (decl.prop === 'font' && file !== 'typography.css') issue(decl, 'Não redefinir a tipografia através de font; reutilizar um papel tipográfico.')
    if (file !== 'typography.css' && decl.parent.type === 'rule' && semanticText.test(decl.parent.selector) && typeProperties.has(decl.prop)) issue(decl, 'Não sobrepor títulos, rótulos ou controlos comuns com tipografia local.')
    if (decl.prop === 'font-size' && !['typography.css', 'design-tokens.css'].includes(file) && decl.value !== '0') {
      const token = /^var\((--font-size-[\w-]+)\)$/.exec(decl.value)?.[1]
      if (!token || !tokens.has(token)) issue(decl, 'Usar um tamanho da escala em design-tokens.css.')
    }
    if (typeProperties.has(decl.prop) && decl.important) issue(decl, 'Não usar !important para impor tipografia.')
  })
  tree.walkAtRules(rule => {
    if (rule.name === 'font-face') issue(rule, 'Uma nova fonte exige atualização explícita da base visual e da sua licença.')
    if (rule.name === 'import' && /https?:|\/\//i.test(rule.params)) issue(rule, 'Não importar estilos/fontes externos para contornar a base visual.')
  })
  return issues
}

export function inspectInlineTypography(node, report) {
  if (node.name?.name !== 'style' || node.value?.expression?.type !== 'ObjectExpression') return
  for (const property of node.value.expression.properties) {
    const key = property.key?.name || property.key?.value
    if (/^(?:font|fontFamily|fontSize|fontWeight|fontStyle|lineHeight|letterSpacing)$/.test(key || '')) report(property)
  }
}

function textWithin(node) {
  return (node.children || []).flatMap(child => child.type === 'JSXText' ? [child.value.trim()] : child.type === 'JSXElement' ? textWithin(child) : [])
}

export default {
  rules: {
    'shared-presentation': {
      meta: { type: 'problem', schema: [], messages: {
        inline: 'Usar os papéis e tokens da base visual; não definir tipografia inline.',
        pagination: 'Reutilizar Pagination para manter a mesma navegação e regra de visibilidade.',
        calendarInput: 'Reutilizar CalendarInput para escolher datas e horas.',
        dateRange: 'Reutilizar DateRangeFields nos pares de datas/horas para garantir o acompanhamento e a validação do fim.'
      } },
      create(context) {
        return {
          JSXAttribute(node) { inspectInlineTypography(node, property => context.report({ node: property, messageId: 'inline' })) },
          JSXElement(node) {
            const opening = node.openingElement
            const attribute = name => opening.attributes.find(item => item.type === 'JSXAttribute' && item.name.name === name)?.value?.value
            const element = opening.name.name
            const file = context.filename.replaceAll('\\', '/')
            if (element === 'input' && ['date', 'datetime-local', 'time'].includes(attribute('type')) && !file.endsWith('/src/CalendarInput.jsx')) context.report({ node, messageId: 'calendarInput' })
            if (element === 'CalendarInput' && ['end', 'to', 'publicationEnd'].includes(attribute('name')) && !file.endsWith('/src/DateRangeFields.jsx')) context.report({ node, messageId: 'dateRange' })
            if (element !== 'nav' || file.endsWith('/src/Pagination.jsx')) return
            const text = textWithin(node)
            if (text.includes('Anterior') && text.includes('Seguinte')) context.report({ node, messageId: 'pagination' })
          },
          AssignmentExpression(node) {
            if (node.left.type !== 'MemberExpression' || node.left.object.type !== 'MemberExpression' || node.left.object.property.name !== 'style') return
            const key = node.left.property.name || node.left.property.value
            if (!/^(?:font|fontFamily|fontSize|fontWeight|fontStyle|lineHeight|letterSpacing)$/.test(key || '')) return
            const fittingSelect = context.filename.replaceAll('\\', '/').endsWith('/src/AdaptiveSelect.jsx') && (
              key === 'fontFamily' && node.right.type === 'MemberExpression' && node.right.object.name === 'source' && node.right.property.name === 'fontFamily'
              || key === 'fontSize' && node.left.object.object.name === 'text' && node.right.type === 'TemplateLiteral'
                && node.right.expressions.length === 1 && node.right.expressions[0].name === 'size'
                && node.right.quasis[0].value.raw === '' && node.right.quasis[1].value.raw === 'px'
            )
            if (!fittingSelect) context.report({ node, messageId: 'inline' })
          }
        }
      }
    }
  }
}
