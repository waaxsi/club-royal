@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
 echo Node.js manque. Demande son installation officielle si ce PC est gere par l'ecole.
 echo Version minimale : 22.16.0. Aucun besoin de npm install pour ce projet.
 pause
 exit /b 1
)
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=16)?0:1)"
if errorlevel 1 (
 echo Node.js 22.16.0 minimum est requis. Mets Node a jour avec autorisation.
 pause
 exit /b 1
)
echo.
echo CLUB ROYAL V2 - serveur local, euros fictifs uniquement.
echo Ouvre http://localhost:3000 sauf si tu as configure un autre PORT.
echo Les adresses effectives seront affichees ci-dessous. Garde cette fenetre ouverte.
echo Aucun logiciel existant n'est ferme et aucun pare-feu n'est modifie.
echo.
node server/index.js
echo.
echo Le serveur s'est arrete. Lis l'erreur ci-dessus si le lancement a echoue.
pause
