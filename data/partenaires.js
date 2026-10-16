/* Atlo · identifiants d'affiliation (vides : aucun lien n'est suivi, aucune commission).
   Pour être rémunéré sur les réservations, inscrivez-vous aux programmes partenaires puis renseignez :
   - booking : identifiant « aid » Booking.com (programme direct, ou via Awin / CJ selon votre pays) ;
   - agoda : identifiant « cid » d'Agoda Partners ;
   - enveloppes : lien de suivi par plateforme, auquel Atlo ajoute l'adresse de destination encodée,
     par exemple Travelpayouts : { booking: "https://tp.media/r?marker=VOTRE_ID&trs=…&p=…&campaign_id=…&u=" }.
   Dès qu'un identifiant est renseigné, les fiches affichent la mention « liens partenaires ». */
self.ATLO_PARTENAIRES = {
  booking: "",
  agoda: "",
  enveloppes: {},
};
