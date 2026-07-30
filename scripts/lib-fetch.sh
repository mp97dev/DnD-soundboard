# Scaricamento robusto, condiviso da fetch-ytdlp.sh e fetch-ffmpeg.sh.
#
# Perché esiste: la release 0.4.0-beta.1 è morta sul runner Windows con
#   curl: (35) schannel: CRYPT_E_REVOCATION_OFFLINE
# cioè il server delle revoche dei certificati non rispondeva. Niente di
# sbagliato nel codice e niente di riproducibile: un singolo intoppo di rete
# ha buttato giù una build da quattro minuti, senza nessun tentativo di
# riprovare. Su una release che si lancia con un tag, rifare tutto a mano è
# lavoro tolto a qualcos'altro.
#
# Due livelli, in quest'ordine:
#  1. fino a 4 tentativi con attesa crescente, verifica TLS piena;
#  2. solo se tutti falliscono E siamo su Windows, un ultimo tentativo con
#     --ssl-no-revoke.
#
# Il secondo livello salta SOLO il controllo di revoca, non la verifica del
# certificato: la catena viene comunque validata. È il compromesso mirato
# all'unico guasto visto davvero, invece di allentare TLS in partenza per
# tutti. Resta l'ultima spiaggia, così un certificato davvero revocato
# continua a fermare i tre tentativi precedenti.
fetch_url() {
  local url="$1" dest="$2"
  local common=(--fail --location --show-error --silent
                --retry 4 --retry-delay 2 --retry-all-errors
                --connect-timeout 20 --max-time 600)

  if curl "${common[@]}" "$url" -o "$dest"; then
    return 0
  fi

  case "${OSTYPE:-}" in
    msys*|cygwin*|win32*)
      echo "    ATTENZIONE: download fallito, riprovo senza controllo di revoca" >&2
      echo "    (il certificato viene comunque verificato; salta solo la lista revoche)" >&2
      curl "${common[@]}" --ssl-no-revoke "$url" -o "$dest"
      ;;
    *)
      return 1
      ;;
  esac
}
