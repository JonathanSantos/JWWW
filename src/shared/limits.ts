/**
 * Teto de funções instrumentadas pelo mapa de execução. Acima disso o embrulho
 * por função pesa mais do que o insight que ele dá — a página fica lenta a
 * ponto de mudar o comportamento que você está tentando observar.
 *
 * Vive aqui porque main e renderer precisam concordar: a UI avisa antes de
 * criar o override, e o motor recusa se passar mesmo assim.
 */
export const LIMITE_FUNCOES = 6000
