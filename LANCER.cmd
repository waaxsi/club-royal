@echo off
chcp 65001 >nul
cd /d "%~dp0"
title CLUB ROYAL - Serveur Poker et Blackjack
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js est absent. Installe Node.js 22 ou une version LTS plus recente avec autorisation de l'ecole.
  echo Puis relance ce fichier. Le projet ne necessite aucun paquet npm.
  pause
  exit /b 1
)
node -e "if(Number(process.versions.node.split('.')[0])<22){console.error('Node.js 22 minimum requis.');process.exit(1)}"
if errorlevel 1 (
  pause
  exit /b 1
)
echo.
echo Demarrage de CLUB ROYAL...
echo Ouvre l'adresse locale affichee ci-dessous dans ton navigateur.
echo Garde cette fenetre ouverte pendant la partie.
echo.
node server/index.js
if errorlevel 1 echo Le serveur n'a pas pu demarrer. Lis le message ci-dessus.
pause
