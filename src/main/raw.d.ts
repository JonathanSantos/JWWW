/** Import de arquivo como texto (`?raw` do Vite) — usado para injetar JS na página. */
declare module '*?raw' {
  const conteudo: string
  export default conteudo
}
