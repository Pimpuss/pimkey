; Désinstallation : l'extension navigateur ne doit plus trouver l'hôte natif de Pimkey (clés créées par Pimkey quand
; on active l'extension). Pas lors d'une mise à jour : Pimkey les réinscrit au démarrage de la nouvelle version.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegKey HKCU "Software\Google\Chrome\NativeMessagingHosts\fr.yalma.pimkey"
    DeleteRegKey HKCU "Software\Microsoft\Edge\NativeMessagingHosts\fr.yalma.pimkey"
    RMDir /r "$APPDATA\Pimkey\native-host"
  ${endIf}
!macroend
