# LDT Love Adventure Online

Mini-jeu aventure multijoueur jouable sur PC et téléphone.

## Ce qu'il y a dedans

- Monde 2D généré automatiquement
- Salon avec code
- Multijoueur à distance avec Socket.IO
- Compatible PC et téléphone
- Joystick mobile + bouton attaque
- Niveaux de plus en plus durs
- Boss tous les 5 niveaux
- Cristaux à récupérer
- Portail pour passer au niveau suivant

## Lancer sur ton PC

1. Installe Node.js.
2. Ouvre un terminal dans ce dossier.
3. Tape :

```bash
npm install
npm start
```

4. Ouvre :

```txt
http://localhost:3000
```

## Jouer avec quelqu'un à distance

Pour jouer à distance, il faut mettre le dossier en ligne sur un hébergeur Node.js comme Render.

### Réglages Render

- Build Command :

```bash
npm install
```

- Start Command :

```bash
npm start
```

Le serveur utilise automatiquement `process.env.PORT`, donc Render peut le lancer correctement.

## Fichiers importants

- `server.js` : serveur multijoueur + logique de jeu
- `public/index.html` : page du jeu
- `public/client.js` : affichage + contrôles PC/téléphone
- `public/style.css` : interface
