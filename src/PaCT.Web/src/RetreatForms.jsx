
export function RetreatDefinition({ definition, disabled }) {
  return <fieldset disabled={disabled}><legend>Programa e condições do retiro</legend>
    <label>Programa completo<textarea name="program" required maxLength="8000" defaultValue={definition?.program || ''} /></label>
    <label>Preço único por participante<input name="totalPrice" type="number" required min="0.01" max="1000000" step="0.01" defaultValue={definition?.totalPrice ?? ''} /></label>
    <label>Condições de cancelamento<textarea name="cancellation" required maxLength="8000" defaultValue={definition?.cancellationConditions || ''} /></label>
    <p>Pagamento integral do valor indicado.</p>
  </fieldset>
}
